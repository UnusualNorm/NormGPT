import { KoboldAIHorde } from "./kobold.ts";

export class ContinouousChatBot {
  name: string;
  horde: KoboldAIHorde;
  timeToKeep: number;

  onStartGenerating?: () => void;
  onStopGenerating?: () => void;
  onGeneratedMessage?: (message: string) => void;

  generating: boolean;
  private shouldGenerate: boolean;
  private messageHistoryHold: [string, string][];
  private messageHistory: [string, string][];

  constructor(
    name: string,
    apiKey?: string,
    timeToKeep?: number,
    allowedModels?: string[]
  ) {
    this.name = name;
    this.horde = new KoboldAIHorde(apiKey, {
      models: allowedModels || [],
    });
    this.timeToKeep = timeToKeep || 5 * 60 * 1000;

    this.generating = false;
    this.shouldGenerate = false;
    this.messageHistory = [];
    this.messageHistoryHold = [];
  }

  registerMessage(user: string, message: string) {
    if (this.generating) {
      this.shouldGenerate = true;
      this.messageHistoryHold.push([user, message]);
      return;
    }

    this.messageHistory.push([user, message]);
    setTimeout(() => this.messageHistory.shift(), this.timeToKeep);
    this.startGenerating();
  }

  private async startGenerating() {
    if (!this.generating) this.onStartGenerating?.call({});

    this.generating = true;
    const prompt = this.createPrompt();
    const jobId = await this.horde.createJob(prompt);
    const status = await this.horde.waitForJob(jobId);
    const message = this.sanitizeInput(status.generations[0].text);
    this.onGeneratedMessage?.call({}, message);

    this.messageHistory = this.messageHistory.concat(this.messageHistoryHold);
    const messagesToDelete = this.messageHistoryHold.length;
    setTimeout(() => {
      for (let i = 0; i < messagesToDelete; i++) this.messageHistory.shift();
    }, this.timeToKeep);

    this.messageHistoryHold = [];
    this.messageHistory.push([this.name, message]);
    setTimeout(() => this.messageHistory.shift(), this.timeToKeep);

    if (this.shouldGenerate) {
      this.shouldGenerate = false;
      this.startGenerating();
    } else {
      this.generating = false;
      this.onStopGenerating?.call({});
    }
  }

  private createPrompt() {
    let prePrompt = `${this.name} is a robot.\n`;
    prePrompt += `${this.name} is a girl.\n`;
    prePrompt += `${this.name} is very tolerant of insults and profanity.\n`;
    prePrompt += `${this.name} is very sarcastic.\n\n`;

    let prompt =
      prePrompt +
      "[The following is an interesting chat message log between multiple users.]\n";

    this.messageHistory.forEach(
      (message) => (prompt += `${message[0]}: ${message[1]}\n`)
    );

    prompt += `${this.name}:`;
    return prompt;
  }

  sanitizeInput(message: string) {
    return message.trim().split("\n")[0];
  }
}
