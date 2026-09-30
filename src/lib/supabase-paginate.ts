// Helpers para contornar o limite padrão de 1.000 linhas por resposta da API.
// fetchAllRows busca em blocos usando .range() até acabar.

export const PAGE_SIZE = 1000;
const MAX_ROWS = 100_000; // trava de segurança

export async function fetchAllRows<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += pageSize) {
    const { data, error } = await run(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data || [];
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}

export function chunk<T>(arr: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Executa uma consulta com filtro .in() em blocos, juntando os resultados.
export async function fetchAllIn<T>(
  ids: string[],
  run: (idsChunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  opts?: { idsPerChunk?: number; pageSize?: number },
): Promise<T[]> {
  const idsPerChunk = opts?.idsPerChunk ?? 200;
  const pageSize = opts?.pageSize ?? PAGE_SIZE;
  const out: T[] = [];
  for (const part of chunk(ids, idsPerChunk)) {
    const rows = await fetchAllRows<T>((from, to) => run(part, from, to), pageSize);
    out.push(...rows);
  }
  return out;
}
