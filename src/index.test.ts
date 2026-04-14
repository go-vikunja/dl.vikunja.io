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

	// Desktop package tests
	it('redirects desktop .deb to /desktop/', () => {
		expect(getPackageRedirect('/repos/apt/pool/Vikunja Desktop-v2.2.0.deb')).toBe(
			'/desktop/v2.2.0/Vikunja Desktop-v2.2.0.deb',
		);
	});

	it('redirects desktop .rpm to /desktop/', () => {
		expect(getPackageRedirect('/repos/rpm/x86_64/Vikunja Desktop-v2.2.0.rpm')).toBe(
			'/desktop/v2.2.0/Vikunja Desktop-v2.2.0.rpm',
		);
	});

	it('redirects desktop .apk to /desktop/', () => {
		expect(getPackageRedirect('/repos/apk/main/x86_64/Vikunja Desktop-v2.2.0.apk')).toBe(
			'/desktop/v2.2.0/Vikunja Desktop-v2.2.0.apk',
		);
	});

	it('redirects desktop .pacman to /desktop/', () => {
		expect(getPackageRedirect('/repos/pacman/x86_64/Vikunja Desktop-v2.2.0.pacman')).toBe(
			'/desktop/v2.2.0/Vikunja Desktop-v2.2.0.pacman',
		);
	});

	it('handles desktop release candidate versions', () => {
		expect(getPackageRedirect('/repos/apt/pool/Vikunja Desktop-v1.0.0-rc1.deb')).toBe(
			'/desktop/v1.0.0-rc1/Vikunja Desktop-v1.0.0-rc1.deb',
		);
	});

	// Unstable build tests
	it('redirects unstable server .deb', () => {
		expect(getPackageRedirect('/repos/apt/pool/vikunja-unstable-x86_64.deb')).toBe(
			'/vikunja/unstable/vikunja-unstable-x86_64.deb',
		);
	});

	it('redirects unstable server .rpm', () => {
		expect(getPackageRedirect('/repos/rpm/x86_64/vikunja-unstable-x86_64.rpm')).toBe(
			'/vikunja/unstable/vikunja-unstable-x86_64.rpm',
		);
	});

	it('redirects unstable desktop .deb', () => {
		expect(getPackageRedirect('/repos/apt/pool/Vikunja Desktop-unstable.deb')).toBe(
			'/desktop/unstable/Vikunja Desktop-unstable.deb',
		);
	});

	it('redirects unstable desktop .pacman', () => {
		expect(getPackageRedirect('/repos/pacman/x86_64/Vikunja Desktop-unstable.pacman')).toBe(
			'/desktop/unstable/Vikunja Desktop-unstable.pacman',
		);
	});

	// Reprepro pool filename tests (APT repos use different naming)
	it('redirects reprepro pool unstable server .deb', () => {
		expect(getPackageRedirect('/repos/apt/pool/main/v/vikunja/vikunja_2.3.0~55-797c8130_amd64.deb')).toBe(
			'/vikunja/unstable/vikunja-unstable-x86_64.deb',
		);
	});

	it('redirects reprepro pool unstable server .deb with URL-encoded tilde', () => {
		expect(getPackageRedirect('/repos/apt/pool/main/v/vikunja/vikunja_2.3.0%7e63-4d8c37f8_amd64.deb')).toBe(
			'/vikunja/unstable/vikunja-unstable-x86_64.deb',
		);
	});

	it('redirects reprepro pool unstable server .deb arm64', () => {
		expect(getPackageRedirect('/repos/apt/pool/main/v/vikunja/vikunja_2.3.0~55-797c8130_arm64.deb')).toBe(
			'/vikunja/unstable/vikunja-unstable-aarch64.deb',
		);
	});

	it('redirects reprepro pool unstable server .deb armhf', () => {
		expect(getPackageRedirect('/repos/apt/pool/main/v/vikunja/vikunja_2.3.0~55-797c8130_armhf.deb')).toBe(
			'/vikunja/unstable/vikunja-unstable-armv7.deb',
		);
	});

	it('redirects reprepro pool stable server .deb', () => {
		expect(getPackageRedirect('/repos/apt/pool/main/v/vikunja/vikunja_0.24.6-1_amd64.deb')).toBe(
			'/vikunja/v0.24.6/vikunja-v0.24.6-x86_64.deb',
		);
	});

	it('redirects reprepro pool unstable desktop .deb', () => {
		expect(getPackageRedirect('/repos/apt/pool/main/v/vikunja-desktop/vikunja-desktop_2.3.0~50~ga1106420_amd64.deb')).toBe(
			'/desktop/unstable/Vikunja Desktop-unstable.deb',
		);
	});

	it('redirects reprepro pool stable desktop .deb', () => {
		expect(getPackageRedirect('/repos/apt/pool/main/v/vikunja-desktop/vikunja-desktop_0.24.6-1_amd64.deb')).toBe(
			'/desktop/v0.24.6/Vikunja Desktop-v0.24.6.deb',
		);
	});

	// APK index filename tests
	it('redirects APK index unstable filename', () => {
		expect(getPackageRedirect('/repos/apk/unstable/main/x86_64/vikunja-2.3.0_63-4d8c37f8.apk')).toBe(
			'/vikunja/unstable/vikunja-unstable-x86_64.apk',
		);
	});

	it('redirects APK index unstable filename aarch64', () => {
		expect(getPackageRedirect('/repos/apk/unstable/main/aarch64/vikunja-2.3.0_63-4d8c37f8.apk')).toBe(
			'/vikunja/unstable/vikunja-unstable-aarch64.apk',
		);
	});

	it('redirects APK index stable filename', () => {
		expect(getPackageRedirect('/repos/apk/stable/main/x86_64/vikunja-0.24.6-r0.apk')).toBe(
			'/vikunja/v0.24.6/vikunja-v0.24.6-x86_64.apk',
		);
	});
});
