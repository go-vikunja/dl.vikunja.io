import { Env, SiteConfig } from './types';
import { renderTemplFull, renderJson } from './render';
import { getSiteConfig } from './config';

const PACKAGE_EXTENSIONS = ['.deb', '.rpm', '.apk', '.archlinux', '.pkg.tar.zst'];

// Matches version like v2.2.0, 0.24.6, v1.0.0-rc1, v1.0.0-beta2, etc.
// Captures the full version including optional v-prefix and pre-release suffix.
const VERSION_RE = /vikunja-(v?\d+\.\d+\.\d+(?:-[a-zA-Z]+\d*)?)-/;

/**
 * For requests under /repos/ that target a package file, redirect to the
 * existing artifact at /vikunja/<version>/<filename> so we don't need to
 * store the same file twice in R2.
 */
export function getPackageRedirect(pathname: string): string | null {
	if (!pathname.startsWith('/repos/')) return null;

	const filename = pathname.split('/').pop();
	if (!filename) return null;

	if (!PACKAGE_EXTENSIONS.some((ext) => filename.endsWith(ext))) return null;

	const match = filename.match(VERSION_RE);
	if (!match) return null;

	const version = match[1];
	return `/vikunja/${version}/${filename}`;
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
