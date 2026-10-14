/// <reference lib="webworker" />
import { convertLocalWord } from "./local-word-pdf";
addEventListener(
  "message",
  async ({ data }: { data: { file: File; assetsBase: string } }) => {
    try {
      const result = await convertLocalWord(
        data.file,
        async (name) => {
          const response = await fetch(new URL(name, data.assetsBase));
          if (!response.ok)
            throw Error(
              "A conversion font could not be loaded. Please reload and retry.",
            );
          return new Uint8Array(await response.arrayBuffer());
        },
        (message) => postMessage({ type: "progress", message }),
      );
      postMessage({ type: "complete", ...result }, [result.bytes.buffer]);
    } catch (error) {
      postMessage({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "The document could not be converted.",
      });
    }
  },
);
