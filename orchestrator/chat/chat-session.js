export class ChatSession {
  constructor(systemPrompt) {
    this.messages = [
      { role: "system", content: systemPrompt }
    ];
  }

  addUserMessage(content) {
    this.messages.push({ role: "user", content });
  }

  addAssistantMessage(content) {
    this.messages.push({ role: "assistant", content });
  }

  getContext() {
    return this.messages;
  }
}
