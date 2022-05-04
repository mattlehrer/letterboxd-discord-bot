import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import 'dotenv/config';
import { Commands } from '../commands/command';

const clientId = process.env.DISCORD_CLIENT_ID;

const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_TOKEN);

export async function DeployCommands(guildId: string): Promise<void> {
	try {
		// console.log(`Deploying slash commands to ${guildId} ...`)

		const resp = await rest.put(
			Routes.applicationGuildCommands(clientId, guildId),
			{
				body: Commands.map((c) => c.command.toJSON()),
			},
		);
		// console.log(resp)

		// console.log('Successfully deployed slash commands.')
	} catch (error) {
		console.error(error);
	}
}

// DeployCommands(process.env.DISCORD_GUILD_ID)
