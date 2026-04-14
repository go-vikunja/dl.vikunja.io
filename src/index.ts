import { Env, SiteConfig } from './types';
import { renderTemplFull, renderJson } from './render';
import { getSiteConfig } from './config';

const PACKAGE_EXTENSIONS = ['.deb', '.rpm', '.apk', '.archlinux', '.pacman', '.pkg.tar.zst'];

// Version pattern shared by both: numeric (v2.2.0, 0.24.6, v1.0.0-rc1) or "unstable"
const VERSION_PATTERN = `(?:v?\\d+\\.\\d+\\.\\d+(?:-[a-zA-Z]+\\d*)?|unstable)`;

// Server packages: vikunja-v2.2.0-x86_64.deb, vikunja-unstable-aarch64.rpm, etc.
const SERVER_VERSION_RE = new RegExp(`vikunja-(${VERSION_PATTERN})-`);

// Desktop packages: Vikunja Desktop-v2.2.0.deb, Vikunja Desktop-unstable.rpm, etc.
const DESKTOP_VERSION_RE = new RegExp(`Vikunja Desktop-(${VERSION_PATTERN})\\.`);

// Reprepro pool filenames: vikunja_2.3.0~55-797c8130_amd64.deb
// The ~ in the version means it's a pre-release (unstable), clean versions are tag releases.
const POOL_SERVER_RE = /^vikunja_([^_]+)_([^.]+)\.deb$/;

// Reprepro pool desktop filenames: vikunja-desktop_2.3.0~50~ga1106420_amd64.deb
const POOL_DESKTOP_RE = /^vikunja-desktop_([^_]+)_([^.]+)\.deb$/;

// APK index filenames: vikunja-2.3.0_63-4d8c37f8.apk
// Alpine uses _ instead of ~ for pre-release, format: <name>-<version>.apk
const APK_SERVER_RE = /^vikunja-(\d+\.\d+\.\d+[^.]*?)\.apk$/;

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

/**
 * For requests under /repos/ that target a package file, redirect to the
 * existing artifact so we don't need to store the same file twice in R2.
 *
 * Server packages redirect to /vikunja/<version>/<filename>.
 * Desktop packages redirect to /desktop/<version>/<filename>.
 *
 * This also handles reprepro pool filenames (APT repos) which use a
 * different naming convention than the original artifacts.
 */
export function getPackageRedirect(pathname: string): string | null {
	if (!pathname.startsWith('/repos/')) return null;

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

	const poolServerMatch = filename.match(POOL_SERVER_RE);
	if (poolServerMatch) {
		const version = pkgVersionToArtifactVersion(poolServerMatch[1]);
		const debArch = poolServerMatch[2];
		const arch = DEBIAN_ARCH_MAP[debArch] || debArch;
		const artifactName = `vikunja-${version}-${arch}.deb`;
		return `/vikunja/${version}/${artifactName}`;
	}

	// Handle APK index filenames: vikunja-2.3.0_63-4d8c37f8.apk
	// Must be before SERVER_VERSION_RE which would partially match these.
	// The arch is in the URL path, not the filename.
	const apkMatch = filename.match(APK_SERVER_RE);
	if (apkMatch) {
		const version = pkgVersionToArtifactVersion(apkMatch[1]);
		const parts = pathname.split('/');
		const arch = parts[parts.length - 2] || 'x86_64';
		const artifactName = `vikunja-${version}-${arch}.apk`;
		return `/vikunja/${version}/${artifactName}`;
	}

	// Generic server pattern: vikunja-<version>-<arch>.<ext>
	const serverMatch = filename.match(SERVER_VERSION_RE);
	if (serverMatch) {
		return `/vikunja/${serverMatch[1]}/${filename}`;
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
