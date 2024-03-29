import {
  createBot,
  getDmChannel,
  getMessage,
  getMessages,
  getUser,
  Intents,
  Message,
  sendMessage,
  startBot,
  startTyping,
} from "https://deno.land/x/discordeno@18.0.1/mod.ts";
import { ChatBot } from "./chatbot.ts";
import "https://deno.land/x/dotenv@v3.2.0/load.ts";
import { Bot } from "https://deno.land/x/discordeno@18.0.1/bot.ts";

const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN");
if (!DISCORD_TOKEN) throw new Error("No Discord Bot Token Provided...");

const CHANNEL_ID = Deno.env.get("CHANNEL_ID");
if (!CHANNEL_ID) throw new Error("No Channel ID Provided...");

const CHATBOT_PERSONA = Deno.env.get("CHATBOT_PERSONA") || undefined;
const CHATBOT_HELLO = Deno.env.get("CHATBOT_HELLO") || undefined;

const MEMORY_TIME = parseFloat(Deno.env.get("MEMORY_TIME")!) || Infinity;
const MEMORY_LIMIT = parseInt(Deno.env.get("MEMORY_LIMIT")!) || Infinity;
const MEMORY_PREFETCH = parseInt(Deno.env.get("MEMORY_PREFETCH") ?? "10");
const MEMORY_COMMAND = Deno.env.get("MEMORY_COMMAND") || undefined;
const MEMORY_RESPONSE = Deno.env.get("MEMORY_RESPONSE") ?? "...";

const KOBOLD_KEY = Deno.env.get("KOBOLD_KEY") ?? "000000000";
const KOBOLD_MODELS = Deno.env.get("KOBOLD_MODELS")?.split(",") ?? [
  "PygmalionAI/pygmalion-6b",
];

const PING_ONLY = Deno.env.get("PING_ONLY") == "true";

let chatbot: ChatBot;
let typingInterval: number;

let needLogIntro = true;
const logIntro = () => {
  const prompt = chatbot.createPrompt().split("\n");
  prompt.pop();
  console.log(prompt.join("\n"));
};

async function parseUserInput(bot: Bot, message: Message) {
  // Make all user mentions @User
  return (
    (await replaceAsync(
      message.content
        // Make it single-line
        .replaceAll("\n", " ")
        // Make all emojis :emoji:
        .replaceAll(
          /<(?:(?<animated>a)?:(?<name>\w{2,32}):)?(?<id>\d{17,21})>/g,
          (...args) => `:${args[2]}:`
        ),
      /<@!?(?<id>\d{17,20})>/g,
      async (...args) => `@${(await getUser(bot, args[1] as bigint)).username}`
      // Add all attachments to the end
    )) + message.attachments.map((attachment) => ` ${attachment.url}`).join("")
  );
}

const bot = createBot({
  token: DISCORD_TOKEN,
  intents: Intents.Guilds | Intents.GuildMessages | Intents.MessageContent,
  events: {
    async ready(bot) {
      const user = await getUser(bot, bot.id);
      console.log(`<CONNECT (${user.username})>`);
      chatbot = new ChatBot({
        name: user.username,
        persona: CHATBOT_PERSONA,
        hello: CHATBOT_HELLO,
        apiKey: KOBOLD_KEY,
        memoryTimeLimit: MEMORY_TIME,
        memorySpaceLimit: MEMORY_LIMIT,
        allowedModels: KOBOLD_MODELS,
        mentionOnly: PING_ONLY,
      });

      chatbot.onGeneratedMessages = async (messages: string[]) => {
        // This should never happen, but just in case...
        if (needLogIntro) {
          needLogIntro = false;
          logIntro();
        }

        for (const message of messages) {
          console.log(`${user.username}:`, message);
          await sendMessage(bot, CHANNEL_ID, {
            content: message || "...",
          });
        }
        if (chatbot.isGenerating) startTyping(bot, CHANNEL_ID);
      };

      chatbot.onStopGenerating = () => clearInterval(typingInterval);
      chatbot.onStartGenerating = () => {
        startTyping(bot, CHANNEL_ID);
        typingInterval = setInterval(() => startTyping(bot, CHANNEL_ID), 7500);
      };

      const messages: [string, string, number][] = await Promise.all(
        (
          await getMessages(bot, CHANNEL_ID, {
            limit: MEMORY_PREFETCH,
          })
        )
          .array()
          .reverse()
          .map(async (message) => [
            (await getUser(bot, message.authorId)).username,
            await parseUserInput(bot, message),
            message.timestamp,
          ])
      );

      chatbot.memory = messages;
      if (messages.length > 0) {
        needLogIntro = false;
        logIntro();
      }
    },
  },
});

const isReplyingToMe = async (bot: Bot, message: Message) =>
  message.messageReference &&
  message.messageReference.channelId &&
  message.messageReference.messageId
    ? (
        await getMessage(
          bot,
          message.messageReference.channelId,
          message.messageReference.messageId
        )
      ).authorId == bot.id
    : false;

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

bot.events.messageCreate = async function (bot, message) {
  if (message.authorId == bot.id) return;
  if (String(message.channelId) != CHANNEL_ID) return;

  const author = await getUser(bot, message.authorId);
  if (MEMORY_COMMAND && message.content === MEMORY_COMMAND) {
    chatbot.clearMemory();
    console.log(`<CLEAR (${author.username})>`);
    needLogIntro = true;
    if (MEMORY_RESPONSE)
      await sendMessage(bot, CHANNEL_ID, {
        content: MEMORY_RESPONSE,
      });
    return;
  }

  const content = await parseUserInput(bot, message);

  chatbot.pushMessage(
    author.username,
    content,
    message.timestamp,
    await isReplyingToMe(bot, message)
  );

  if (needLogIntro) {
    needLogIntro = false;
    logIntro();
  } else console.log(`${author.username}:`, content);
};

await startBot(bot);
