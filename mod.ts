import {
  createBot,
  Intents,
  startBot,
  sendMessage,
  getDmChannel,
  getUser,
  startTyping,
  getMessages,
} from "https://deno.land/x/discordeno@18.0.1/mod.ts";
import { ChatBot } from "./chatbot.ts";
import "https://deno.land/x/dotenv@v3.2.0/load.ts";

const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN");
if (!DISCORD_TOKEN) throw new Error("No Discord Token Provided...");

const CHANNEL_ID = Deno.env.get("CHANNEL_ID");
if (!CHANNEL_ID) throw new Error("No Channel ID Provided...");

const CHATBOT_NAME = Deno.env.get("CHATBOT_NAME");
const CHATBOT_PERSONA = Deno.env.get("CHATBOT_PERSONA");
const CHATBOT_HELLO = Deno.env.get("CHATBOT_HELLO");
if (!CHATBOT_NAME) throw new Error("No Chatbot Name Provided...");

const DEMENTIA_TIME = parseFloat(Deno.env.get("DEMENTIA_TIME") || "");
const DEMENTIA_COMMAND = Deno.env.get("DEMENTIA_COMMAND");

const KOBOLD_MODELS = Deno.env.get("KOBOLD_MODELS")?.split(",");
const KOBOLD_KEY = Deno.env.get("KOBOLD_KEY");

const PRIVACY_NOTICE = Deno.env.get("PRIVACY_NOTICE") != "false";

const chatbot = new ChatBot(
  CHATBOT_NAME,
  CHATBOT_PERSONA,
  CHATBOT_HELLO,
  KOBOLD_KEY,
  DEMENTIA_TIME,
  KOBOLD_MODELS
);

let typingInterval: number;
const bot = createBot({
  token: DISCORD_TOKEN,
  intents: Intents.Guilds | Intents.GuildMessages | Intents.MessageContent,
  events: {
    async ready(bot) {
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

      const messages = await getMessages(bot, CHANNEL_ID, {
        limit: 10,
      });
      chatbot.messageHistory = await Promise.all(
        messages.map(async (message) => [
          (await getUser(bot, message.authorId)).username,
          message.content,
          Date.now(),
        ])
      );
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
        content: `By continuing to send messages in this channel, you agree to your messages being stored for ${DEMENTIA_TIME} minutes.`,
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

  if (DEMENTIA_COMMAND && message.content == DEMENTIA_COMMAND) {
    await chatbot.clearMemory();
    return sendMessage(bot, CHANNEL_ID, {
      content: "https://tenor.com/view/crying-emoji-dies-gif-21956120",
    });
  }

  const content =
    // Make all user mentions @User
    (await replaceAsync(
      message.content
        // Make it single-line
        .replaceAll("\n", " ")
        // Make all emojis :emoji:
        .replaceAll(
          /^(?:<(?<animated>a)?:(?<name>\w{2,32}):)?(?<id>\d{17,21})>?$/g,
          (...args) => `:${args[2]}:`
        ),
      /^<@!?(?<id>\d{17,20})>$/g,
      async (...args) => `@${(await getUser(bot, args[1] as bigint)).username}`
      // Add all attachments to the end
    )) + message.attachments.map((attachment) => ` ${attachment.url}`).join("");

  const author = await getUser(bot, message.authorId);
  if (!chatbot.helloName) chatbot.helloName = author.username;

  chatbot.registerMessage(author.username, content);
  console.log(`${author.username}:`, content);
};

await startBot(bot);
