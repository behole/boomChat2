import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { renderer } from "./renderer";
import { EventSourceParserStream } from "eventsource-parser/stream";
import { Ai } from "@cloudflare/workers-types";

type Bindings = {
  AI: Ai;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(renderer);

app.get("/", (c) => {
  return c.render(
    <>
     <div className="flex h-screen bg-gray-200">
  {/* Chat interface */}
  <div className="flex-grow flex flex-col">
    <div
      id="chat-history"
      className="flex-1 overflow-y-auto p-6 space-y-4 bg-white flex flex-col-reverse messages-container"
    ></div>
    <div className="px-6 py-2 bg-white shadow-up">
      <form className="flex items-center" id="chat-form">
        <textarea
          id="message-input"
          className="flex-grow m-2 p-2 border border-chat-border rounded shadow-sm placeholder-chat-placeholder"
          placeholder="Type a message..."
        ></textarea>
        <button
          type="submit"
          className="m-2 px-4 py-2 bg-chat-button text-black rounded hover:bg-gray-300"
        >
          Send
        </button>
      </form>
      <div className="text-xs text-gray-500 mt-2">
        <p className="model-display">-</p>
        <input
          type="hidden"
          class="message-user message-assistant message-model"
        />
      </div>
    </div>
  </div>
  
  {/* Settings bar removed */}
</div>
      <script src="/static/script.js"></script>
    </>
  );
});

app.post("/api/chat", async (c) => {
  const payload = await c.req.json();
  const messages = [...payload.messages];
  // Prepend the systemMessage
  if (payload?.config?.systemMessage) {
    messages.unshift({ role: "system", content: payload.config.systemMessage });
  }
  //console.log("Model", payload.config.model);
  //console.log("Messages", JSON.stringify(messages));
  let eventSourceStream;
  let retryCount = 0;
  let successfulInference = false;
  let lastError;
  const MAX_RETRIES = 3;
  while (successfulInference === false && retryCount < MAX_RETRIES) {
    try {
      eventSourceStream = (await c.env.AI.run(payload.config.model, {
        messages,
        stream: true,
      })) as ReadableStream;
      successfulInference = true;
    } catch (err) {
      lastError = err;
      retryCount++;
      console.error(err);
      console.log(`Retrying #${retryCount}...`);
    }
  }
  if (eventSourceStream === undefined) {
    if (lastError) {
      throw lastError;
    }
    throw new Error(`Problem with model`);
  }
  // EventSource stream is handy for local event sources, but we want to just stream text
  const tokenStream = eventSourceStream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream());

  return streamText(c, async (stream) => {
    for await (const msg of tokenStream) {
      if (msg.data !== "[DONE]") {
        const data = JSON.parse(msg.data);
        stream.write(data.response);
      }
    }
  });
});

export default app;
