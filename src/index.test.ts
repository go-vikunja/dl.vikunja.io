import { describe, it, expect } from 'vitest';
import { wantsJson, getPackageRedirect } from './index';

describe('wantsJson', () => {
	it('returns true for .json path suffix', () => {
		const request = new Request('https://dl.vikunja.io/vikunja/.json');
		expect(wantsJson(request)).toBe(true);
	});

	it('returns true for Accept: application/json header', () => {
		const request = new Request('https://dl.vikunja.io/vikunja/', {
			headers: { Accept: 'application/json' },
		});
		expect(wantsJson(request)).toBe(true);
	});

	it('returns false for normal HTML request', () => {
		const request = new Request('https://dl.vikunja.io/vikunja/');
		expect(wantsJson(request)).toBe(false);
	});

	it('returns false for Accept: text/html', () => {
		const request = new Request('https://dl.vikunja.io/vikunja/', {
			headers: { Accept: 'text/html' },
		});
		expect(wantsJson(request)).toBe(false);
	});

	it('returns true when Accept header contains application/json among others', () => {
		const request = new Request('https://dl.vikunja.io/vikunja/', {
			headers: { Accept: 'text/html, application/json' },
		});
		expect(wantsJson(request)).toBe(true);
	});
});

describe('getPackageRedirect', () => {
	it('redirects .deb files from apt repo to existing path', () => {
		expect(getPackageRedirect('/repos/apt/pool/vikunja-v2.2.0-x86_64.deb')).toBe(
			'/vikunja/v2.2.0/vikunja-v2.2.0-x86_64.deb',
		);
	});

	it('redirects .rpm files from rpm repo', () => {
		expect(getPackageRedirect('/repos/rpm/x86_64/vikunja-v2.2.0-x86_64.rpm')).toBe(
			'/vikunja/v2.2.0/vikunja-v2.2.0-x86_64.rpm',
		);
	});

	it('redirects .apk files from apk repo', () => {
		expect(getPackageRedirect('/repos/apk/v3.21/main/x86_64/vikunja-v2.2.0-x86_64.apk')).toBe(
			'/vikunja/v2.2.0/vikunja-v2.2.0-x86_64.apk',
		);
	});

	it('redirects .archlinux files from pacman repo', () => {
		expect(getPackageRedirect('/repos/pacman/x86_64/vikunja-v2.2.0-x86_64.archlinux')).toBe(
			'/vikunja/v2.2.0/vikunja-v2.2.0-x86_64.archlinux',
		);
	});

	it('redirects .pkg.tar.zst files from pacman repo', () => {
		expect(getPackageRedirect('/repos/pacman/x86_64/vikunja-2.2.0-1-x86_64.pkg.tar.zst')).toBe(
			'/vikunja/2.2.0/vikunja-2.2.0-1-x86_64.pkg.tar.zst',
		);
	});

	it('handles versions without v prefix', () => {
		expect(getPackageRedirect('/repos/apt/pool/vikunja-0.24.6-x86_64.deb')).toBe(
			'/vikunja/0.24.6/vikunja-0.24.6-x86_64.deb',
		);
	});

	it('handles release candidate versions', () => {
		expect(getPackageRedirect('/repos/apt/pool/vikunja-v1.0.0-rc1-x86_64.deb')).toBe(
			'/vikunja/v1.0.0-rc1/vikunja-v1.0.0-rc1-x86_64.deb',
		);
	});

	it('returns null for non-repo paths', () => {
		expect(getPackageRedirect('/vikunja/v2.2.0/vikunja-v2.2.0-x86_64.deb')).toBeNull();
	});

	it('returns null for non-package files under repos', () => {
		expect(getPackageRedirect('/repos/apt/dists/stable/Release')).toBeNull();
	});

	it('returns null for files without a version', () => {
		expect(getPackageRedirect('/repos/apt/pool/something.deb')).toBeNull();
	});
});
