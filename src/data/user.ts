import fetch from 'node-fetch';
import Parser from 'rss-parser';
import { DB, redis } from '../data/db';
import { ItemType, parseItem, RSSItem } from '../lib/rss';

export class User {
	private _username: string;
	public set username(value: string) {
		this._username = User.parseUsername(value);
	}
	public get username(): string {
		return this._username;
	}
	public createdAt: number;
	public updatedAt: number;
	public lastCheckedAt?: number;
	public guildId: string;
	public loaded: boolean;

	constructor(guildId: string) {
		this.guildId = guildId;
	}

	public static all(guildId: string): Promise<User[]> {
		const promise = new Promise<User[]>((resolve, reject) => {
			let _users: Promise<User>[] = [];

			const stream = redis.scanStream({
				match: `users:${guildId}*`,
			});

			stream.on('data', async (resultKeys) => {
				for (let i = 0; i < resultKeys.length; i++) {
					const match = resultKeys[i].match(/users:[0-9]+:(.*)/);
					if (match) {
						let user = User.get(match[1], guildId);
						_users.push(user);
					}
				}
			});

			stream.on('end', () => {
				resolve(Promise.all(_users));
			});
		});

		return promise;
	}

	public static async allStale(guildId: string): Promise<User[]> {
		const delayBeforeCheck = 60 * 10 * 1000; // 10 minutes
		const users = await User.all(guildId);

		return users.filter((user) => {
			const elapsed = new Date().getTime() - (user.lastCheckedAt || 0);
			// if (elapsed <= delayBeforeCheck)
			//     console.log(`=> Skipping ${user.username} - last updated`, elapsed / 1000, 'seconds ago', user.lastCheckedAt)
			return elapsed > delayBeforeCheck;
		});
	}

	public static parseUsername(username: string): string {
		const match = username.match(/\/\/letterboxd\.com\/([a-z0-9_]+)/);
		if (match) {
			return match[1];
		}

		const cleanMatch = username.match(/([a-z0-9_]+)/i);
		if (cleanMatch) {
			return cleanMatch[1];
		}
		return null;
	}

	public static async get(username: string, guildId: string): Promise<User> {
		const user = new User(guildId);
		user.username = username;

		if (!user.username) return null;
		let userData = await DB('users', guildId).get(user.username);
		if (!userData) return null;

		user.createdAt = new Date(userData.createdAt).getTime();
		user.updatedAt = new Date(userData.updatedAt).getTime();
		user.lastCheckedAt = new Date(userData.lastCheckedAt).getTime();
		user.loaded = true;
		return user;
	}

	public static async clear(guildId: string): Promise<void> {
		return await DB('users', guildId).clear();
	}

	public get letterboxdUrl(): string {
		return `https://letterboxd.com/${this.username}/`;
	}

	public get letterboxdRssUrl(): string {
		return `https://letterboxd.com/${this.username}/rss/`;
	}

	public async isValidUser(): Promise<boolean> {
		const rsp = await fetch(this.letterboxdUrl, {
			method: 'HEAD',
		});
		return rsp.status != 404;
	}

	public async exists(): Promise<boolean> {
		return (await User.get(this.username, this.guildId)) != null;
	}

	public async getLatestDiaryEntries(): Promise<RSSItem[]> {
		console.log(
			`Fetching RSS feed for ${this.username} - ${this.letterboxdRssUrl}`,
		);
		const parser = new Parser({
			customFields: {
				item: [
					['letterboxd:rewatch', 'rewatch'],
					['letterboxd:watchedDate', 'watchedDate'],
					['letterboxd:filmTitle', 'filmTitle'],
					['letterboxd:filmYear', 'filmYear'],
					['letterboxd:memberRating', 'memberRating'],
					['dc:creator', 'creator'],
				],
			},
		});
		let feed: RSSItem[] = [];
		try {
			const data = await parser.parseURL(this.letterboxdRssUrl);
			feed = data.items
				.map((i) => parseItem(i))
				.filter((i) => i.type == ItemType.Review || i.type == ItemType.Watch);
		} catch (e) {
			console.error(e);
			return feed;
		}

		return feed.filter((item) => item.pubDate.getTime() >= this.updatedAt);
		// return feed.slice(0, 5)
	}

	public async delete(): Promise<boolean> {
		return await DB('users', this.guildId).delete(this.username);
	}

	public async save(): Promise<boolean> {
		if (!this.username) {
			return false;
		}

		// initial insert
		if (!this.loaded && !(await this.exists())) {
			if (!this.createdAt) this.createdAt = new Date().getTime();
			if (!this.updatedAt) this.updatedAt = new Date().getTime();

			if (!(await this.isValidUser())) {
				return false;
			}
		} else {
			// console.log(`${this._username} updated`)
		}

		this.loaded = true;
		return await DB('users', this.guildId).set(this.username, this);
	}
}
