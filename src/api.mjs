// Arsenal's public fixtures API: the same GraphQL feed arsenal.com/tickets uses in the browser.
const ENDPOINT = process.env.ARSENAL_API || 'https://afc-prd.graph.arsenal.com/graphql';
const PAGE_SIZE = 100;

const QUERY = `query Fixtures($pageNumber: Float!, $pageSize: Float!) {
  getAllLatestLiveReports(filterByTaxonomy: "all", pageSize: $pageSize, pageNumber: $pageNumber) {
    total
    data {
      id
      customTypeData {
        fixtureDetails {
          arsenalTeam { slug }
          fixtureDate
          opponent { name }
          competition { name }
          venueType1
        }
        metaData {
          fixtureTicketing { ballot ballotOpenDate ballotCloseDate ballotLink ticketLink }
        }
      }
    }
  }
}`;

async function fetchPage(pageNumber) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://www.arsenal.com',
      Referer: 'https://www.arsenal.com/tickets',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    },
    body: JSON.stringify({ query: QUERY, variables: { pageNumber, pageSize: PAGE_SIZE } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Arsenal API answered HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(`Arsenal API error: ${body.errors[0].message}`);
  return body.data.getAllLatestLiveReports;
}

// Every upcoming fixture across all teams. Pages are numbered from 0.
export async function fetchFixtures() {
  const fixtures = [];
  for (let page = 0; ; page++) {
    const { total, data } = await fetchPage(page);
    fixtures.push(...data);
    if (data.length < PAGE_SIZE || fixtures.length >= total) break;
  }
  if (fixtures.length === 0) throw new Error('Arsenal API returned no fixtures; the API may have changed');
  return fixtures;
}
