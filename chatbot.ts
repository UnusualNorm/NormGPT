import { JobStatusResponse, KoboldAIHorde } from "./kobold.ts";

const sleep = (time: number) =>
  new Promise<void>((res) => setTimeout(res, time));

export class ChatBot {
  name: string;
  persona?: string;
  hello?: string;
  horde: KoboldAIHorde;
  memoryTimeLimit: number;
  memorySpaceLimit: number;

  memory: [string, string, number][];
  isGenerating!: boolean;
  shouldContinueGenerating!: boolean;
  cancelGeneration!: () => Promise<void> | void;

  onStartGenerating?: () => void;
  onStopGenerating?: () => void;
  onGeneratedMessages?: (messages: string[]) => void;

  canceling!: boolean;

  constructor(
    opts: {
      name: string;
      persona?: string;
      hello?: string;
      apiKey: string;
      memoryTimeLimit: number;
      allowedModels: string[];
      memorySpaceLimit: number;
    },
    memory?: [string, string, number][]
  ) {
    this.name = opts.name;
    this.persona = opts.persona;
    this.hello = opts.hello;
    this.horde = new KoboldAIHorde(opts.apiKey, {
      models: opts.allowedModels,
    });
    this.memoryTimeLimit = opts.memoryTimeLimit ?? 10;
    this.memorySpaceLimit = opts.memorySpaceLimit ?? Infinity;
    this.memory = memory ?? [];
  }

  cleanMemory() {
    const limit = Date.now() - this.memoryTimeLimit * 60 * 1000;
    this.memory = this.memory
      .filter(([_name, _content, date]) => limit <= date)
      .slice(0, this.memorySpaceLimit);
  }

  async pushMessage(
    user: string,
    message: string,
    timestamp: number
  ): Promise<void> {
    this.memory.push([user, message, timestamp]);
    if (this.isGenerating && !this.canceling) await this.cancelGeneration();
    if (!this.isGenerating && !this.canceling) return this.startGenerating();
    else if (this.isGenerating && !this.canceling)
      this.shouldContinueGenerating = true;
    return;
  }

  async startGenerating(): Promise<void> {
    if (!this.isGenerating) this.onStartGenerating?.();
    this.isGenerating = true;
    this.cleanMemory();

    let cancelled = false;
    let cancelPromise: () => void;
    this.cancelGeneration = () =>
      new Promise<void>((res) => {
        this.canceling = true;
        cancelled = true;
        cancelPromise = res;
      });

    let status: JobStatusResponse;
    try {
      // TODO: Figure out how I can do this with openai... (Doesn't allow cancelling of jobs)
      // Maybe we can create artificial generation lag? Although that doesn't fix the issue at hand...
      const prompt = this.createPrompt();
      const jobId = await this.horde.createJob(prompt);
      if (cancelled) {
        await this.horde.cancelJob(jobId);
        this.canceling = false;
        this.isGenerating = false;
        this.onStopGenerating?.();
        cancelPromise!();
        return;
      }

      this.cancelGeneration = async () => {
        this.canceling = true;
        await this.horde.cancelJob(jobId);
        this.canceling = false;
        this.isGenerating = false;
        this.onStopGenerating?.();
        return;
      };

      let done = false;
      while (!done) {
        await sleep(1500);
        if (cancelled) return;
        status = await this.horde.getJob(jobId);
        done = status.done;
        if (!status.is_possible || status.faulted)
          throw new Error("Generation failed.");
      }

      const messages = this.parseInput(status!.generations[0]?.text || "...");
      this.onGeneratedMessages?.(messages);
      for (const message of messages)
        this.memory.push([this.name, message, Date.now()]);

      // If someone tried to cancel while we were grabbing our finished message,
      // Ignore it, that's wasted effort.
      if (this.shouldContinueGenerating) {
        this.shouldContinueGenerating = false;
        return this.startGenerating();
      } else {
        this.isGenerating = false;
        this.onStopGenerating?.();
        return;
      }
    } catch (error: any) {
      this.isGenerating = false;
      console.error(`<ERROR (${error?.message})>`);
      this.memory.push([this.name, "...", Date.now()]);
      this.onGeneratedMessages?.(["..."]);
      this.onStopGenerating?.();
    }
  }

  async clearMemory() {
    this.shouldContinueGenerating = false;
    this.memory = [];
    await this.cancelGeneration?.call({});
    return;
  }

  createPrompt() {
    const helloName = this.memory.find(
      (message) => message[0] !== this.name
    )?.[0];

    // If we have a persona, add it to the prompt
    let prompt = this.persona
      ? `${this.name}\'s Persona: ${this.persona}\n`
      : "";

    // The docs say to add this as a delimiter
    prompt += "<START>\n";

    // If we have a hello message, add it to the prompt
    !this.hello || (prompt += `${helloName || "User"}: Hello ${this.name}!\n`);
    !this.hello || (prompt += `${this.name}: ${this.hello}\n`);

    // Add all the messages in the memory to the prompt
    prompt += this.memory
      .map((message) => `${message[0]}: ${message[1]}`)
      .join("\n");

    // Add the chat bot's name to the prompt
    prompt += `\n${this.name}:`;
    return prompt;
  }

  private parseInput(message: string) {
    // The AI likes to impersonate the user, remember to check for that
    const lines = message.trim().split("\n");

    // The first line is always the bot's response
    const botLine = lines.splice(0, 1)[0];

    // Get all lines that start with the bot's name
    let foundImpersonation = false;
    const botLines = lines
      .filter((line) => {
        if (foundImpersonation) return false;
        if (line.startsWith(`${this.name}: `)) return true;
        foundImpersonation = true;
        return false;
      })
      .map((line) => line.replace(`${this.name}: `, "").trim());

    return [botLine, ...botLines];
  }
}
