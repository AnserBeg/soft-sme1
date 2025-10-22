import { z } from 'zod';

const isoDatetime = () => {
  const base = z.string();
  if (typeof (base as any).datetime === 'function') {
    return (base as any).datetime();
  }
  return base.refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Invalid datetime string',
  });
};

export const Id = z.number().int().positive();

const limitedNote = z.string().max(2000);

export const QuoteCreateArgs = z
  .object({
    customer_id: Id,
    valid_until: isoDatetime().optional(),
    line_items: z
      .array(
        z
          .object({
            part_id: Id,
            qty: z.number().gt(0),
            unit_price: z.number().min(0),
          })
          .strict()
      )
      .min(1),
    notes: limitedNote.optional(),
  })
  .strict();

export const QuoteUpdateArgs = z
  .object({
    quote_id: Id,
    patch: z
      .object({
        valid_until: isoDatetime().optional(),
        status: z.enum(['Open', 'Won', 'Lost', 'Expired']).optional(),
        notes: limitedNote.optional(),
      })
      .strict(),
  })
  .strict();

export const SalesOrderPatch = z
  .object({
    invoice_status: z.enum(['Draft', 'Pending', 'Sent', 'Paid']).optional(),
    due_date: isoDatetime().optional(),
    notes: limitedNote.optional(),
  })
  .strict();

export const PurchaseOrderPatch = z
  .object({
    status: z.enum(['Draft', 'Pending', 'Sent', 'Received', 'Closed']).optional(),
    subtotal: z.number().min(0).optional(),
    total_gst_amount: z.number().min(0).optional(),
    total_amount: z.number().min(0).optional(),
    notes: limitedNote.optional(),
  })
  .strict();

export const TaskCreateArgs = z
  .object({
    title: z.string().min(1),
    status: z.enum(['Open', 'In Progress', 'Blocked', 'Done']).optional(),
    due_date: isoDatetime().optional(),
    assignee_ids: z.array(Id).optional(),
  })
  .strict();

export const TaskUpdateArgs = z
  .object({
    id: Id,
    patch: z
      .object({
        status: z.enum(['Open', 'In Progress', 'Blocked', 'Done']).optional(),
        note: limitedNote.optional(),
        due_date: isoDatetime().optional(),
      })
      .strict(),
  })
  .strict();

export const LookupArgs = z
  .object({
    entity_type: z.enum(['vendor', 'customer', 'part']),
    term: z.string().min(1),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10),
  })
  .strict();

export type QuoteCreateArgs = z.infer<typeof QuoteCreateArgs>;
export type QuoteUpdateArgs = z.infer<typeof QuoteUpdateArgs>;
export type SalesOrderPatch = z.infer<typeof SalesOrderPatch>;
export type PurchaseOrderPatch = z.infer<typeof PurchaseOrderPatch>;
export type TaskCreateArgs = z.infer<typeof TaskCreateArgs>;
export type TaskUpdateArgs = z.infer<typeof TaskUpdateArgs>;
export type LookupArgs = z.infer<typeof LookupArgs>;
