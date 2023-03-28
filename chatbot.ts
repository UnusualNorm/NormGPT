import { KoboldAIHorde } from "./kobold.ts";

const sleep = (time: number) =>
  new Promise<void>((res) => setTimeout(res, time));

export class ChatBot {
  name: string;
  helloName: string | undefined;
  persona: string;
  hello: string;
  horde: KoboldAIHorde;
  memoryTimeLimit: number;
  memorySpaceLimit: number;

  memory: [string, string, number][];
  isGenerating!: boolean;
  shouldContinueGenerating!: boolean;
  cancelGeneration!: () => Promise<void> | void;

  onStartGenerating?: () => void;
  onStopGenerating?: () => void;
  onGeneratedMessage?: (message: string) => void;

  private canceling!: boolean;

  constructor(
    opts: {
      name: string;
      persona?: string;
      hello?: string;
      apiKey?: string;
      memoryTimeLimit?: number;
      allowedModels?: string[];
      memorySpaceLimit?: number;
    },
    memory?: [string, string, number][]
  ) {
    this.name = opts.name;
    this.persona = opts.persona ?? "A friendly AI chatbot.";
    this.hello = opts.hello ?? "Hey there! How can I help you today?";
    this.horde = new KoboldAIHorde(opts.apiKey ?? "000000000", {
      models: opts.allowedModels || ["PygmalionAI/pygmalion-6b"],
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

  async pushMessage(user: string, message: string): Promise<void> {
    this.memory.push([user, message, Date.now()]);
    if (this.isGenerating && !this.canceling) await this.cancelGeneration();
    if (!this.isGenerating && !this.canceling) return this.startGenerating();
    else this.shouldContinueGenerating = true;
    return;
  }

  private async startGenerating(): Promise<void> {
    if (!this.isGenerating) this.onStartGenerating?.();
    this.isGenerating = true;
    this.cleanMemory();
    this.cancelGeneration = () => {
      this.canceling = true;
    };

    try {
      // TODO: Figure out how I can do this with openai... (Doesn't allow cancelling of jobs)
      // Maybe we can create artificial generation lag? Although that doesn't fix the issue at hand...
      const prompt = this.createPrompt();
      const jobId = await this.horde.createJob(prompt);

      let done = false;
      while (!done) {
        await sleep(1500);
        const status = await this.horde.getJob(jobId);
        done = status.done;
        if (!status.is_possible || status.faulted)
          throw new Error("Generation failed.");

        if (this.canceling) {
          this.horde.cancelJob(jobId);
          this.canceling = false;
          if (this.shouldContinueGenerating) return this.startGenerating();
          this.isGenerating = false;
          this.onStopGenerating?.();
          return;
        }
      }

      const status = await this.horde.getJob(jobId);
      const message = this.parseInput(status.generations[0]?.text || "...");

      this.onGeneratedMessage?.(message);
      this.memory.push([this.name, message, Date.now()]);

      if (this.shouldContinueGenerating) {
        this.shouldContinueGenerating = false;
        this.canceling = false;
        this.startGenerating();
      } else {
        this.isGenerating = false;
        this.canceling = false;
        this.onStopGenerating?.();
      }
    } catch (error: any) {
      this.isGenerating = false;
      this.canceling = false;
      this.onGeneratedMessage?.("...");
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
    let prompt = `${this.name}\'s Persona: ${this.persona}\n`;
    prompt += "<START>\n";
    prompt += `${this.helloName || "Unusual Norm"}: Hello ${this.name}!\n`;
    prompt += `${this.name}: ${this.hello}\n`;

    prompt += this.memory
      .map((message) => `${message[0]}: ${message[1]}`)
      .join("\n");

    prompt += `\n${this.name}:`;
    return prompt;
  }

  private parseInput(message: string) {
    return message.trim().split("\n")[0]!;
  }
}
