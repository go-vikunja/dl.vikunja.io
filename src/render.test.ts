import { describe, it, expect } from 'vitest';
import { renderJson } from './render';

describe('renderJson', () => {
	it('returns JSON with files and folders', () => {
		const files = [
			{
				key: 'vikunja/vikunja-0.24.6.zip',
				size: 1024000,
				uploaded: new Date('2025-01-15T10:30:00Z'),
			},
			{
				key: 'vikunja/vikunja-0.24.5.zip',
				size: 2048000,
				uploaded: new Date('2025-01-10T08:00:00Z'),
			},
		] as R2Object[];

		const folders = ['vikunja/unstable/', 'vikunja/v0.24/'];

		const result = JSON.parse(renderJson(files, folders, '/vikunja/'));

		expect(result).toEqual({
			path: '/vikunja/',
			folders: [
				{ name: 'unstable', path: '/vikunja/unstable/' },
				{ name: 'v0.24', path: '/vikunja/v0.24/' },
			],
			files: [
				{
					name: 'vikunja-0.24.6.zip',
					path: '/vikunja/vikunja-0.24.6.zip',
					size: 1024000,
					modified: '2025-01-15T10:30:00.000Z',
				},
				{
					name: 'vikunja-0.24.5.zip',
					path: '/vikunja/vikunja-0.24.5.zip',
					size: 2048000,
					modified: '2025-01-10T08:00:00.000Z',
				},
			],
		});
	});

	it('returns JSON with empty files and folders', () => {
		const result = JSON.parse(renderJson([], [], '/'));

		expect(result).toEqual({
			path: '/',
			folders: [],
			files: [],
		});
	});
});
