import { Router } from 'express';
import { bot } from '../../../bot';
import Guilds from '../../../data/guilds';
import { SavedGuild } from '../../../data/models/guild';
import { UserDocument } from '../../../data/models/user';
import Users from '../../../data/users';
import Deps from '../../../utils/deps';
import { sendError } from '../../modules/api-utils';
import { ServerWidgetGenerator } from '../../modules/image/guild-widget-generator';
import Stats from '../../modules/stats';
import { AuthClient } from '../../server';
import { getUser } from '../user-routes';

export const router = Router();

const guilds = Deps.get<Guilds>(Guilds),
      stats = Deps.get<Stats>(Stats),
      users = Deps.get<Users>(Users);

router.get('/', async (req, res) => {
    try {
        const guilds = [];
        const savedGuilds = await SavedGuild.find();

        for (const savedGuild of savedGuilds) {
            const guild = bot.guilds.cache.get(savedGuild.id);
            if (!guild) continue;

            guilds.push({
                ...guild,
                iconURL: guild.iconURL({ dynamic: true, size: 256 })
            });
        }
        res.json({ saved: savedGuilds, guilds });
    } catch (error) { sendError(res, 400, error); }
});

router.get('/user', async (req, res) => {
    try {
        const bots = await getManagableBots(req.query.key);
        res.json(bots);
    } catch (error) { sendError(res, 400, error); }
});

router.get('/:id', (req, res) => {
    try {
        const guild = bot.guilds.cache.get(req.params.id);
        res.json({
            ...guild,
            iconURL: guild.iconURL({ dynamic: true, size: 256 })
        });
    } catch (error) { sendError(res, 400, error); }
});

router.delete('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await validateServerManager(req.query.key, id);

        await guilds.delete(id);

        res.json({ success: true });
    } catch (error) { sendError(res, 400, error); }
});

router.get('/:id/vote', async (req, res) => {
    try {        
        const voter = await getUser(req.query.key);
        const savedVoter = await users.get(voter);

        validateIfCanVote(savedVoter);

        savedVoter.lastVotedAt = new Date();
        await savedVoter.save();

        const savedGuild = await guilds.get(req.params.id);
        savedGuild.votes.push({ at: new Date(), by: voter.id });
        savedGuild.totalVotes++;
        savedGuild.lastVoteAt = new Date();
        await savedGuild.save();

        res.json({ success: true });        
    } catch (error) { sendError(res, 400, error); }
});

router.get('/:id/saved', async (req, res) => {
    try {
        const savedGuild = await guilds.get(req.params.id);
        res.json(savedGuild);
    } catch (error) { sendError(res, 400, error); }
});

router.get('/:id/widget', async (req, res) => {
    try {
        const guild = bot.guilds.cache.get(req.params.id);
        const savedGuild = await guilds.get(req.params.id);
        const image = await new ServerWidgetGenerator(guild, savedGuild)
            .generate(req.query.size?.toString() ?? 'large');
        
        res.set({ 'Content-Type': 'image/png' }).send(image);
    } catch (error) { sendError(res, 400, error); }
});

router.get('/:id/stats', (req, res) => {
    const id = req.params.id;

    res.json({
        general: stats.general(id),
        topVoters: stats.votes(id),
        votes: stats.votes(id),
        recentVotes: stats.recentVotes(id)
    });
});

function validateIfCanVote(savedVoter: UserDocument) {
    const twelveHoursMs = 1000 * 60 * 60 * 12;
    const oneDayAgo = new Date(Date.now() - twelveHoursMs);
    if (savedVoter.lastVotedAt > oneDayAgo) {
        const timeLeftMs = new Date(savedVoter.lastVotedAt.getTime() + twelveHoursMs).getTime() - Date.now();
        const hoursLeft = (timeLeftMs / 1000 / 60 / 60);
        throw new TypeError(`You have already voted. You can next vote in ${hoursLeft.toFixed(2)} hours.`);
    }
}

async function getManagableBots(key: any) {
    const { id } = await AuthClient.getUser(key);
    const owner = bot.users.cache.get(id);

    const savedGuilds = await guilds.getManageable(owner);
    const ids = savedGuilds.map(b => b._id);

    return bot.users.cache.filter(u => ids.includes(u.id));
}

export async function validateServerManager(key: any, botId: string) {
    if (!key)
        throw new TypeError('Unauthorized.');

    const bots = await getManagableBots(key);
    if (!bots.some(b => b.id === botId))
        throw TypeError('Bot not manageable.');
}

export interface BotStats {
    guildCount: number;
}