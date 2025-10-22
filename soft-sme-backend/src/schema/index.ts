import { z } from 'zod';

const chatContextSchema = z.record(z.unknown());

export const ChatIn = z
  .object({
    sessionId: z.number().int().positive(),
    message: z.string().min(1),
    context: chatContextSchema.optional(),
  })
  .strict();

const TextEvent = z
  .object({
    type: z.literal('text'),
    text: z.string(),
  })
  .strict();

const ToolStartEvent = z
  .object({
    type: z.literal('tool_start'),
    tool: z.string(),
    args: z.unknown(),
  })
  .strict();

const ToolResultEvent = z
  .object({
    type: z.literal('tool_result'),
    tool: z.string(),
    result: z.unknown(),
  })
  .strict();

const DocsEvent = z
  .object({
    type: z.literal('docs'),
    items: z
      .array(
        z
          .object({
            path: z.string(),
            chunk: z.string(),
            citation: z
              .object({
                title: z.string(),
                score: z.number().optional(),
              })
              .optional(),
          })
          .strict()
      )
      .min(0),
  })
  .strict();

const ErrorEvent = z
  .object({
    type: z.literal('error'),
    message: z.string(),
  })
  .strict();

export const StreamEvent = z.discriminatedUnion('type', [
  TextEvent,
  ToolStartEvent,
  ToolResultEvent,
  DocsEvent,
  ErrorEvent,
]);

export const ChatOut = z
  .object({
    events: z.array(StreamEvent),
    done: z.boolean(),
  })
  .strict();

export type ChatIn = z.infer<typeof ChatIn>;
export type StreamEvent = z.infer<typeof StreamEvent>;
export type ChatOut = z.infer<typeof ChatOut>;
