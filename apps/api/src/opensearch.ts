type SearchDocument = {
  id: string;
  title: string | null;
  description: string | null;
  priceMinor: number | null;
  currency: string;
  categorySlug: string;
  categoryName: string;
  city: string | null;
  postalCode: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  publishedAt: string | null;
};

type OpenSearchResult = {
  ids: string[];
  total: number;
};

const endpoint = process.env.OPENSEARCH_URL?.replace(/\/$/, "");
const indexName = process.env.OPENSEARCH_INDEX ?? "petitannonces-listings-v1";

export function isOpenSearchEnabled() {
  return Boolean(endpoint);
}

export async function searchOpenSearch(params: {
  q?: string;
  category?: string;
  city?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  page: number;
  limit: number;
}): Promise<OpenSearchResult | null> {
  if (!endpoint) return null;

  const must: unknown[] = [];
  const filter: unknown[] = [{ term: { status: "PUBLISHED" } }];

  if (params.q) {
    must.push({
      multi_match: {
        query: params.q,
        fields: ["title^4", "description", "categoryName^2", "city^2"],
        fuzziness: "AUTO",
      },
    });
  }
  if (params.category) filter.push({ term: { categorySlug: params.category } });
  if (params.city) filter.push({ term: { "city.keyword": params.city } });
  if (params.minPriceMinor !== undefined || params.maxPriceMinor !== undefined) {
    filter.push({
      range: {
        priceMinor: {
          ...(params.minPriceMinor !== undefined ? { gte: params.minPriceMinor } : {}),
          ...(params.maxPriceMinor !== undefined ? { lte: params.maxPriceMinor } : {}),
        },
      },
    });
  }

  const response = await fetch(`${endpoint}/${indexName}/_search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.OPENSEARCH_AUTH ? { authorization: process.env.OPENSEARCH_AUTH } : {}),
    },
    body: JSON.stringify({
      from: (params.page - 1) * params.limit,
      size: params.limit,
      query: { bool: { must: must.length ? must : [{ match_all: {} }], filter } },
      sort: params.q ? ["_score", { publishedAt: "desc" }] : [{ publishedAt: "desc" }],
      _source: false,
    }),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as {
    hits?: { total?: number | { value: number }; hits?: Array<{ _id: string }> };
  };
  const totalRaw = payload.hits?.total;
  const total = typeof totalRaw === "number" ? totalRaw : totalRaw?.value ?? 0;
  return { ids: payload.hits?.hits?.map((hit) => hit._id) ?? [], total };
}

export async function indexListing(document: SearchDocument) {
  if (!endpoint) return false;
  const response = await fetch(`${endpoint}/${indexName}/_doc/${document.id}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(process.env.OPENSEARCH_AUTH ? { authorization: process.env.OPENSEARCH_AUTH } : {}),
    },
    body: JSON.stringify({ ...document, status: "PUBLISHED" }),
  });
  return response.ok;
}
