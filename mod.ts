import {
  createBot,
  Intents,
  startBot,
  sendMessage,
  getDmChannel,
  getUser,
  startTyping,
} from "https://deno.land/x/discordeno@18.0.1/mod.ts";
import { ContinouousChatBot } from "./chatbot.ts";
import "https://deno.land/x/dotenv@v3.2.0/load.ts";

const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN");
if (!DISCORD_TOKEN) throw new Error("No Discord Token Provided...");

const CHANNEL_ID = Deno.env.get("CHANNEL_ID");
if (!CHANNEL_ID) throw new Error("No Channel ID Provided...");

const CHATBOT_NAME = Deno.env.get("CHATBOT_NAME");
if (!CHATBOT_NAME) throw new Error("No Chatbot Name Provided...");

const ALLOWED_MODELS = Deno.env.get("ALLOWED_MODELS")?.split(",");
const MEMORY_TIME = parseFloat(Deno.env.get("MEMORY_TIME") || "") || 10;
const PRIVACY_NOTICE = Deno.env.get("PRIVACY_NOTICE") != "false";
const KOBOLD_KEY = Deno.env.get("KOBOLD_KEY");
const chatbot = new ContinouousChatBot(
  CHATBOT_NAME,
  KOBOLD_KEY,
  MEMORY_TIME * 60 * 1000,
  ALLOWED_MODELS
);

let typingInterval: number;
const bot = createBot({
  token: DISCORD_TOKEN,
  intents: Intents.Guilds | Intents.GuildMessages | Intents.MessageContent,
  events: {
    ready(bot) {
      console.log("Successfully connected to gateway :) me happ");
      chatbot.onGeneratedMessage = async (message: string) => {
        console.log(`${CHATBOT_NAME}:`, message);
        await sendMessage(bot, CHANNEL_ID, {
          content: message,
        });
        if (chatbot.generating) startTyping(bot, CHANNEL_ID);
      };

      chatbot.onStopGenerating = () => clearInterval(typingInterval);
      chatbot.onStartGenerating = () => {
        startTyping(bot, CHANNEL_ID);
        typingInterval = setInterval(() => startTyping(bot, CHANNEL_ID), 7500);
      };
    },
  },
});

async function replaceAsync(
  str: string,
  regex: RegExp,
  asyncFn: (match: string, ...args: unknown[]) => Promise<string>
) {
  const promises: Promise<string>[] = [];
  str.replace(regex, (match, ...args) => {
    const promise = asyncFn(match, ...args);
    promises.push(promise);
    return match;
  });
  const data = await Promise.all(promises);
  return str.replace(regex, () => data.shift() || "");
}

const peopleICanHarvestDataFrom: bigint[] = [];
bot.events.messageCreate = async function (bot, message) {
  if (message.authorId == bot.id) return;
  if (String(message.channelId) != CHANNEL_ID) return;

  if (PRIVACY_NOTICE && !peopleICanHarvestDataFrom.includes(message.authorId)) {
    console.log("User did not see my data harvesting notice :( big sad");
    try {
      const dm = await getDmChannel(bot, message.authorId);
      await sendMessage(bot, dm.id, {
        content: `By continuing to send messages in this channel, you agree to your messages being stored for ${MEMORY_TIME} minutes.`,
      });
      peopleICanHarvestDataFrom.push(message.authorId);
    } catch (e) {
      console.error(e);
      await sendMessage(bot, CHANNEL_ID, {
        content: `<@${message.authorId}>, I failed to send the Privacy Notice to your dm's... (Check your privacy settings?)`,
      });
    }
    return;
  }

  const content =
    (await replaceAsync(
      message.content
        .replaceAll("\n", " ")
        .replaceAll(
          /^(?:<(?<animated>a)?:(?<name>\w{2,32}):)?(?<id>\d{17,21})>?$/g,
          (...args) => `:${args[2]}:`
        ),
      /^<@!?(?<id>\d{17,20})>$/g,
      async (...args) => `@${(await getUser(bot, args[1] as bigint)).username}`
    )) + message.attachments.map((attachment) => ` ${attachment.url}`).join("");

  const author = await getUser(bot, message.authorId);
  chatbot.registerMessage(author.username, content);
  console.log(`${author.username}:`, content);
};

await startBot(bot);
