import { Env, SiteConfig } from './types';
import { renderTemplFull, renderJson } from './render';
import { getSiteConfig } from './config';

const PACKAGE_EXTENSIONS = ['.deb', '.rpm', '.apk', '.archlinux', '.pacman', '.pkg.tar.zst'];

const VERSION_PATTERN = `(?:v?\\d+\\.\\d+\\.\\d+(?:-[a-zA-Z]+\\d*)?|unstable)`;
const PACKAGE_NAME_PATTERN = '[a-z0-9][a-z0-9+.-]*?';

const PACKAGE_VERSION_RE = new RegExp(`^(${PACKAGE_NAME_PATTERN})-(${VERSION_PATTERN})-`);

// Desktop packages: Vikunja Desktop-v2.2.0.deb, Vikunja Desktop-unstable.rpm, etc.
const DESKTOP_VERSION_RE = new RegExp(`Vikunja Desktop-(${VERSION_PATTERN})\\.`);

const POOL_PACKAGE_RE = new RegExp(`^(${PACKAGE_NAME_PATTERN})_([^_]+)_([^.]+)\\.deb$`);

// Reprepro pool desktop filenames: vikunja-desktop_2.3.0~50~ga1106420_amd64.deb
const POOL_DESKTOP_RE = /^vikunja-desktop_([^_]+)_([^.]+)\.deb$/;

const APK_PACKAGE_RE = new RegExp(`^(${PACKAGE_NAME_PATTERN})-(\\d+\\.\\d+\\.\\d+[^.]*?)\\.apk$`);

// Map Debian architecture names to Go/nfpm architecture names
const DEBIAN_ARCH_MAP: Record<string, string> = {
	amd64: 'x86_64',
	arm64: 'aarch64',
	armhf: 'armv7',
};

/**
 * Determine the artifact version directory from a package manager version string.
 * Debian: versions containing ~ are pre-releases (unstable).
 * Alpine: versions containing _ are pre-releases (unstable).
 * Clean versions like "0.24.6-1" map to tag releases like "v0.24.6".
 */
function pkgVersionToArtifactVersion(pkgVersion: string): string {
	if (pkgVersion.includes('~') || pkgVersion.includes('_')) {
		return 'unstable';
	}
	// Strip the package revision suffix (-1, -r0, etc.)
	const upstream = pkgVersion.replace(/-(?:r?\d+)$/, '');
	return `v${upstream}`;
}

// Repository package files are omitted from R2 to avoid duplicating release artifacts.
export function getPackageRedirect(pathname: string): string | null {
	if (!pathname.startsWith('/repos/')) return null;

	// Handle .sig requests by redirecting to the signature of the resolved artifact
	if (pathname.endsWith('.sig')) {
		const base = getPackageRedirect(pathname.slice(0, -'.sig'.length));
		return base ? base + '.sig' : null;
	}

	const rawFilename = pathname.split('/').pop();
	if (!rawFilename) return null;
	const filename = decodeURIComponent(rawFilename);

	if (!PACKAGE_EXTENSIONS.some((ext) => filename.endsWith(ext))) return null;

	// Try desktop pattern first (more specific prefix)
	const desktopMatch = filename.match(DESKTOP_VERSION_RE);
	if (desktopMatch) {
		return `/desktop/${desktopMatch[1]}/${filename}`;
	}

	// Handle reprepro pool filenames (APT repos)
	const poolDesktopMatch = filename.match(POOL_DESKTOP_RE);
	if (poolDesktopMatch) {
		const version = pkgVersionToArtifactVersion(poolDesktopMatch[1]);
		const artifactName = `Vikunja Desktop-${version}.deb`;
		return `/desktop/${version}/${artifactName}`;
	}

	const poolMatch = filename.match(POOL_PACKAGE_RE);
	if (poolMatch) {
		const [, name, pkgVersion, debArch] = poolMatch;
		const version = pkgVersionToArtifactVersion(pkgVersion);
		const arch = DEBIAN_ARCH_MAP[debArch] || debArch;
		return `/${name}/${version}/${name}-${version}-${arch}.deb`;
	}

	// APK index versions would partially match the artifact filename pattern below.
	const apkMatch = filename.match(APK_PACKAGE_RE);
	if (apkMatch) {
		const [, name, pkgVersion] = apkMatch;
		const version = pkgVersionToArtifactVersion(pkgVersion);
		const parts = pathname.split('/');
		const arch = parts[parts.length - 2] || 'x86_64';
		return `/${name}/${version}/${name}-${version}-${arch}.apk`;
	}

	const packageMatch = filename.match(PACKAGE_VERSION_RE);
	if (packageMatch) {
		return `/${packageMatch[1]}/${packageMatch[2]}/${filename}`;
	}

	return null;
}

async function listBucket(bucket: R2Bucket, options?: R2ListOptions): Promise<R2Objects> {
    // List all objects in the bucket, launch new request if list is truncated
    const objects: R2Object[] = [];
    const delimitedPrefixes: string[] = [];

    // delete limit, cursor in passed options
    const requestOptions = {
        ...options,
        limit: undefined,
        cursor: undefined,
    };

    var cursor = undefined;
    while (true) {
        const index = await bucket.list({
            ...requestOptions,
            cursor,
        });
        objects.push(...index.objects);
        delimitedPrefixes.push(...index.delimitedPrefixes);
        if (!index.truncated) {
            break;
        }
        cursor = index.cursor;
    }
    return {
        objects,
        delimitedPrefixes,
        truncated: false,
    };
}

function shouldReturnOriginResponse(originResponse: Response, siteConfig: SiteConfig): boolean {
    const isNotEndWithSlash = originResponse.url.slice(-1) !== '/';
    const is404 = originResponse.status === 404;
    const isZeroByte = originResponse.headers.get('Content-Length') === '0';
    const overwriteZeroByteObject = (siteConfig.dangerousOverwriteZeroByteObject ?? false) && isZeroByte;

    // order matters here
    if (isNotEndWithSlash) return true;
    if (is404) {
        return false;
    } else {
        return !overwriteZeroByteObject;
    }
}

export function wantsJson(request: Request): boolean {
	const url = new URL(request.url);
	if (url.pathname.endsWith('.json')) {
		return true;
	}
	const accept = request.headers.get('Accept') ?? '';
	return accept.includes('application/json');
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const domain = url.hostname;
        const isJson = wantsJson(request);

        // Redirect repo package requests to existing artifacts
        const redirect = getPackageRedirect(url.pathname);
        if (redirect) {
            return Response.redirect(new URL(redirect, url.origin).toString(), 302);
        }

        // Serve repo metadata directly from R2 bucket binding to avoid
        // Cloudflare CDN re-compressing files, which changes sizes and
        // breaks hash verification by package managers (apt, dnf, etc.).
        if (url.pathname.startsWith('/repos/') && !url.pathname.endsWith('/')) {
            const siteConfig = getSiteConfig(env, domain);
            if (siteConfig) {
                const key = url.pathname.slice(1); // strip leading /
                const object = await siteConfig.bucket.get(key);
                if (object) {
                    const headers = new Headers();
                    object.writeHttpMetadata(headers);
                    headers.set('etag', object.httpEtag);
                    return new Response(object.body, { headers });
                }
            }
        }

        // Strip .json suffix for bucket lookup
        let path = url.pathname;
        if (path.endsWith('.json')) {
            path = path.slice(0, -'.json'.length);
            // Ensure path ends with / for directory listing
            if (!path.endsWith('/')) {
                path += '/';
            }
        }

        const siteConfig = getSiteConfig(env, domain);
        if (!siteConfig) {
            if (isJson) {
                return new Response(JSON.stringify({ error: 'site not configured' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            const originResponse = await fetch(request);
            return originResponse;
        }

        const objectKey = siteConfig.decodeURI ? decodeURIComponent(path.slice(1)) : path.slice(1);

        if (!isJson) {
            const originResponse = await fetch(request);
            if (shouldReturnOriginResponse(originResponse, siteConfig)) {
                return originResponse;
            }

            const bucket = siteConfig.bucket;
            const index = await listBucket(bucket, {
                prefix: objectKey,
                delimiter: '/',
                include: ['httpMetadata', 'customMetadata'],
            });
            const files = index.objects.filter((obj) => obj.key !== objectKey);
            const folders = index.delimitedPrefixes.filter((prefix) => prefix !== objectKey);
            if (files.length === 0 && folders.length === 0 && originResponse.status === 404) {
                return originResponse;
            }
            return new Response(renderTemplFull(files, folders, '/' + objectKey, siteConfig), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
                status: 200,
            });
        }

        // JSON response path
        const bucket = siteConfig.bucket;
        const index = await listBucket(bucket, {
            prefix: objectKey,
            delimiter: '/',
            include: ['httpMetadata', 'customMetadata'],
        });
        const files = index.objects.filter((obj) => obj.key !== objectKey);
        const folders = index.delimitedPrefixes.filter((prefix) => prefix !== objectKey);
        if (files.length === 0 && folders.length === 0) {
            return new Response(JSON.stringify({ error: 'not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return new Response(renderJson(files, folders, '/' + objectKey), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    },
};
