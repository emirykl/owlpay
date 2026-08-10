import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;
export interface FakeError { code?: string; message: string }

interface Result { data: unknown; error: FakeError | null; count?: number | null }

/**
 * A minimal stand-in for the PostgREST query builder, covering only the call
 * shapes the repositories actually use. It exists so the Supabase adapters —
 * which hold the wallet-linking and payment-replay rules — can be tested
 * without a live database.
 */
class FakeQuery implements PromiseLike<Result> {
  private operation: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private readonly filters: Array<(row: Row) => boolean> = [];
  private payload: Row | Row[] = {};
  private orderBy?: { column: string; ascending: boolean };
  private rowLimit?: number;
  private countRequested = false;

  constructor(
    private readonly rows: Row[],
    private readonly nextError: () => FakeError | null
  ) {}

  select(_columns = '*', options?: { count?: string; head?: boolean }) {
    this.countRequested = options?.count === 'exact';
    return this;
  }
  // PostgREST accepts a single row or a batch; both reach here.
  insert(payload: Row | Row[]) { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload: Row) { this.operation = 'update'; this.payload = payload; return this; }
  upsert(payload: Row) { this.operation = 'upsert'; this.payload = payload; return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  neq(column: string, value: unknown) { this.filters.push((row) => row[column] !== value); return this; }
  is(column: string, value: unknown) { this.filters.push((row) => (row[column] ?? null) === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  contains(column: string, values: unknown[]) {
    this.filters.push((row) => Array.isArray(row[column]) && values.every((value) => (row[column] as unknown[]).includes(value)));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }
  limit(value: number) { this.rowLimit = value; return this; }

  single(): Promise<Result> { return this.run('single'); }
  maybeSingle(): Promise<Result> { return this.run('maybeSingle'); }

  then<A, B = never>(
    onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return this.run('many').then(onFulfilled, onRejected);
  }

  private async run(shape: 'single' | 'maybeSingle' | 'many'): Promise<Result> {
    const error = this.nextError();
    if (error) return { data: null, error };

    if (this.operation === 'insert') {
      const inserted = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((row) => ({ ...row }));
      this.rows.push(...inserted);
      return { data: inserted, error: null };
    }

    if (this.operation === 'upsert') {
      const payload = this.payload as Row;
      const index = this.rows.findIndex((row) => row.id === payload.id);
      if (index === -1) this.rows.push({ ...payload });
      else this.rows[index] = { ...this.rows[index], ...payload };
      return { data: [{ ...payload }], error: null };
    }

    let matched = this.rows.filter((row) => this.filters.every((predicate) => predicate(row)));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      matched = [...matched].sort((left, right) => {
        const comparison = String(left[column] ?? '').localeCompare(String(right[column] ?? ''));
        return ascending ? comparison : -comparison;
      });
    }
    if (this.rowLimit !== undefined) matched = matched.slice(0, this.rowLimit);
    if (this.operation === 'update') {
      for (const row of matched) Object.assign(row, this.payload as Row);
    }

    if (shape === 'many') return { data: matched, error: null, ...(this.countRequested ? { count: matched.length } : {}) };
    if (matched.length === 0) {
      return shape === 'single'
        ? { data: null, error: { code: 'PGRST116', message: 'no rows returned' } }
        : { data: null, error: null };
    }
    return { data: matched[0], error: null };
  }
}

export function createFakeSupabase(tables: Record<string, Row[]>) {
  const queued: Array<{ table?: string; error: FakeError }> = [];
  const rpcResults = new Map<string, Result>();
  const client = {
    from(table: string) {
      tables[table] ??= [];
      return new FakeQuery(tables[table], () => {
        // Match by table so a test can fail one specific step of a multi-query
        // operation rather than whichever query happens to run first.
        const index = queued.findIndex((entry) => !entry.table || entry.table === table);
        return index === -1 ? null : queued.splice(index, 1)[0]!.error;
      });
    },
    rpc(name: string) {
      return Promise.resolve(rpcResults.get(name) ?? {
        data: null,
        error: { code: 'PGRST202', message: `Function ${name} was not found` }
      });
    }
  };
  return {
    client: client as unknown as SupabaseClient,
    tables,
    /** Makes the next query fail, optionally only on a given table. */
    failNext(error: FakeError, table?: string) { queued.push({ error, ...(table ? { table } : {}) }); },
    respondToRpc(name: string, result: Result) { rpcResults.set(name, result); }
  };
}
