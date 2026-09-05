import {
  EditBuilder,
  isDelete,
  isInsert,
  isRetain,
  type EditOperation,
  type EditScript,
} from "./text.js";

/**
 * A cursor over an edit script that can consume part of an operation, since
 * SPEC.md §6.3 splits counts as needed.
 */
class Cursor {
  private index = 0;
  private consumed = 0;

  constructor(private readonly script: EditScript) {}

  peek(): EditOperation | undefined {
    return this.script[this.index];
  }

  /** Remaining base tokens in the current retain or delete. */
  remaining(): number {
    const operation = this.peek();
    if (operation === undefined) return 0;
    if (isRetain(operation)) return operation.retain - this.consumed;
    if (isDelete(operation)) return operation.delete - this.consumed;
    return 0;
  }

  advance(): void {
    this.index += 1;
    this.consumed = 0;
  }

  consume(count: number): void {
    this.consumed += count;
    if (this.remaining() === 0) this.advance();
  }

  done(): boolean {
    return this.index >= this.script.length;
  }
}

/**
 * SPEC.md §6.3. Transforms incoming edit `P` so it applies after the
 * aggregate context edit `Q`.
 *
 * The `Q insert` row has priority, so concurrent inserts at one cursor appear
 * in canonical integration order. Deletion consumes only base tokens, so text
 * inserted concurrently survives.
 */
export function transform(incoming: EditScript, context: EditScript): EditScript {
  const output = new EditBuilder();
  const p = new Cursor(incoming);
  const q = new Cursor(context);

  while (!p.done() || !q.done()) {
    const contextOperation = q.peek();
    if (contextOperation !== undefined && isInsert(contextOperation)) {
      // Retain over text the context inserted; it is not P's to touch.
      output.retain(contextOperation.insert.length);
      q.advance();
      continue;
    }

    const incomingOperation = p.peek();
    if (incomingOperation !== undefined && isInsert(incomingOperation)) {
      output.insert(incomingOperation.insert);
      p.advance();
      continue;
    }

    // Both streams consume the same base token count, so once inserts are
    // exhausted either both have base operations left or both are finished.
    if (incomingOperation === undefined || contextOperation === undefined) break;

    const count = Math.min(p.remaining(), q.remaining());
    if (isRetain(incomingOperation) && isRetain(contextOperation)) {
      output.retain(count);
    } else if (isDelete(incomingOperation) && isRetain(contextOperation)) {
      output.delete(count);
    }
    // P retain over Q delete, and P delete over Q delete, both emit nothing:
    // the base tokens they referred to are already gone.
    p.consume(count);
    q.consume(count);
  }

  return output.build();
}
