import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { renderer } from "./renderer";
import { EventSourceParserStream } from "eventsource-parser/stream";
import { Ai } from "@cloudflare/workers-types";
import { useState, useEffect } from "react";

type Bindings = {
  AI: Ai;
};

const app = new Hono<{ Bindings: Bindings }>();

// State to control sidebar visibility and settings visibility
const [sidebarVisible, setSidebarVisible] = useState(true);
const [settingsVisible, setSettingsVisible] = useState(false);

const toggleSidebar = () => {
  setSidebarVisible(!sidebarVisible);
};

const toggleSettings = () => {
  setSettingsVisible(!settingsVisible);
};

app.use(renderer);

app.get("/", (c) => {
  return c.render(
    <>
      <div className="flex h-screen bg-gray-200">
        {/* Toggle button for settings */}
        <button
          className="m-2 p-2 bg-blue-500 text-white rounded md:hidden"
          onClick={toggleSettings}
        >
          {settingsVisible ? "Hide Settings" : "Show Settings"}
        </button>

        {/* Chat interface */}
        <div className={`flex-grow flex flex-col ${settingsVisible ? "ml-64" : ""}`}>
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
                className="message-user message-assistant message-model"
              />
            </div>
          </div>
        </div>

        {/* Settings Sidebar - Hidden by default */}
        {settingsVisible && (
          <div className="w-64 bg-gray-300 p-4">
            {/* Settings content here */}
            <p>Settings Content</p>
          </div>
        )}
      </div>
      <script src="/static/script.js"></script>
    </>
  );
});

app.post("/api/chat", async (c) => {
  const payload = await c.req.json();
  const messages = [...payload.messages];
  if (payload?.config?.systemMessage) {
    messages.unshift({ role: "system", content: payload.config.systemMessage });
  }

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
