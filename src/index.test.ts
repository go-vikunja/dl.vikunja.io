import { describe, it, expect } from 'vitest';
import { wantsJson } from './index';

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
