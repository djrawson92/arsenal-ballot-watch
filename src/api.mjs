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

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://www.arsenal.com',
      Referer: 'https://www.arsenal.com/tickets',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Arsenal API answered HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(`Arsenal API error: ${body.errors[0].message}`);
  return body.data;
}

async function fetchPage(pageNumber) {
  return (await gql(QUERY, { pageNumber, pageSize: PAGE_SIZE })).getAllLatestLiveReports;
}

// The match's "Ticket information" article (the page arsenal.com links from each fixture),
// as its raw body nodes. Null when the club hasn't published one.
export async function fetchTicketArticle(fixtureId) {
  const links = await gql(
    `query Links($ids: [Float!]!) {
      getTicketArticlesByLiveReportIds(liveReportIds: $ids, withRestrictedTaxonomy: false) { data { article { path articleId } } }
    }`,
    { ids: [Number(fixtureId)] },
  );
  const article = links.getTicketArticlesByLiveReportIds.data?.[0]?.article;
  if (!article?.path) return null;
  // The glide id is the last part of the article's path, e.g. …-ipswich-town-aeFa20i5Lj2n.
  const glideId = article.path.split('-').pop();
  const data = await gql(
    `query Article($articleId: String!, $glideId: String!, $glidePath: String!) {
      getArticle(articleId: $articleId, glideId: $glideId, glidePath: $glidePath, platform: "web") { articleBody }
    }`,
    { articleId: String(article.articleId), glideId, glidePath: article.path },
  );
  return data.getArticle?.articleBody ?? null;
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
