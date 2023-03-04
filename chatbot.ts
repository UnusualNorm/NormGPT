import { KoboldAIHorde } from "./kobold.ts";

const sleep = (time: number) =>
  new Promise<void>((res) => setTimeout(res, time));

export class ChatBot {
  name: string;
  helloName: string | undefined;
  persona: string;
  hello: string;
  horde: KoboldAIHorde;
  timeToKeep: number;

  messageHistory: [string, string, number][];
  generating!: boolean;
  shouldGenerate!: boolean;
  cancelGeneration!: () => Promise<void> | void;

  onStartGenerating?: () => void;
  onStopGenerating?: () => void;
  onGeneratedMessage?: (message: string) => void;

  private canceling!: boolean;

  constructor(
    name: string,
    persona?: string,
    hello?: string,
    apiKey?: string,
    timeToKeep?: number,
    allowedModels?: string[]
  ) {
    this.name = name;
    this.persona = persona || "A chatbot.";
    this.hello = hello || "Hello there!";
    this.horde = new KoboldAIHorde(apiKey, {
      models: allowedModels || [],
    });
    this.timeToKeep = (timeToKeep || 5) * 60 * 1000;
    this.messageHistory = [];
  }

  dementiate() {
    const limit = Date.now() - this.timeToKeep;
    this.messageHistory = this.messageHistory.filter(
      ([_name, _content, date]) => limit <= date
    );
  }

  async registerMessage(user: string, message: string): Promise<void> {
    this.messageHistory.push([user, message, Date.now()]);
    if (this.generating && !this.canceling) await this.cancelGeneration();
    if (!this.generating) return this.startGenerating();
    else this.shouldGenerate = true;
    return;
  }

  private async startGenerating(): Promise<void> {
    if (!this.generating) this.onStartGenerating?.call({});
    this.canceling = false;
    this.generating = true;
    this.shouldGenerate = false;

    this.dementiate();
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
        done = status.done || !status.is_possible || status.faulted;
        if (this.canceling) {
          if (this.shouldGenerate) return this.startGenerating();
          this.generating = false;
          this.canceling = false;
          this.horde.cancelJob(jobId);
          this.onStopGenerating?.call({});
          return;
        }
      }

      const status = await this.horde.getJob(jobId);
      const message = this.parseInput(status.generations[0].text);

      this.onGeneratedMessage?.call({}, message);
      this.messageHistory.push([this.name, message, Date.now()]);

      if (this.shouldGenerate) this.startGenerating();
      else {
        this.generating = false;
        this.onStopGenerating?.call({});
      }
    } catch (error) {
      console.error(
        `Encountered an error while generating :( sadge (${error.message})`
      );

      this.generating = false;
      this.canceling = false;
    }
  }

  async clearMemory() {
    this.shouldGenerate = false;
    this.messageHistory = [];
    await this.cancelGeneration?.call({});
    return;
  }

  private createPrompt() {
    let prompt = `${this.name}\'s Persona: ${this.persona}\n`;
    prompt += "<START>\n";
    prompt += `${this.helloName || "Unusual Norm"}: Hello ${this.name}!\n`;
    prompt += `${this.name}: ${this.hello}\n`;

    prompt += this.messageHistory.map(
      (message) => `${message[0]}: ${message[1]}\n`
    );

    prompt += `${this.name}:`;
    return prompt;
  }

  private parseInput(message: string) {
    return message.trim().split("\n")[0];
  }
}
