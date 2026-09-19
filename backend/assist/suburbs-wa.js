'use strict';

/**
 * PLACE NAMES — Perth metropolitan suburbs and the WA regional centres the
 * practice is likely to meet. A suburb with an age group and a kind of school
 * is how one child is picked out; the suburb is hidden and the fact that it IS
 * a suburb is kept: "[SUBURB_1]".
 *
 * Matched only when written with capitals ("Hamilton Hill", never "the hill").
 * Not hidden, on purpose: capital-city names and the regions ("Perth", "the
 * South West") — they identify nobody — and suburb names that are also first
 * names or everyday words on their own (Leeming is fine; "Victoria Park" is
 * matched as a pair, "Victoria" alone is not).
 *
 * A client's OWN recorded suburb is matched separately and exactly by
 * known-values.js, whatever it is. This list is the general net. Add to it
 * freely: a missing suburb is still offered on the review card as a
 * capitalised word; a wrongly listed one is restored when the reply returns.
 */
const SUBURBS = `Alexander Heights|Alfred Cove|Alkimos|Applecross|Ardross|Armadale|Ascot|Ashby|Ashfield|Attadale|Atwell|Aubin Grove|Aveley|Balcatta|Baldivis|Balga|Ballajura|Banjup|Banksia Grove|Bassendean|Bateman|Bayswater|Beaconsfield|Beckenham|Bedford|Bedfordale|Beechboro|Beeliar|Beldon|Bellevue|Belmont|Bennett Springs|Bentley|Bertram|Bibra Lake|Bicton|Booragoon|Boya|Brabham|Brentwood|Brigadoon|Brookdale|Bull Creek|Bullsbrook|Burns Beach|Burswood|Butler|Byford|Calista|Camillo|Canning Vale|Cannington|Carine|Carlisle|Carramar|Caversham|Champion Lakes|Churchlands|City Beach|Claremont|Clarkson|Cloverdale|Cockburn Central|Como|Connolly|Coogee|Coolbellup|Coolbinia|Cooloongup|Cottesloe|Craigie|Crawley|Currambine|Daglish|Dalkeith|Darch|Darlington|Dayton|Dianella|Doubleview|Duncraig|East Cannington|East Fremantle|East Perth|East Victoria Park|Eden Hill|Edgewater|Eglinton|Ellenbrook|Embleton|Ferndale|Floreat|Forrestdale|Forrestfield|Gidgegannup|Girrawheen|Glen Forrest|Glendalough|Gnangara|Golden Bay|Gooseberry Hill|Gosnells|Greenmount|Greenwood|Guildford|Gwelup|Hamersley|Hamilton Hill|Hammond Park|Harrisdale|Haynes|Hazelmere|Heathridge|Helena Valley|Henley Brook|Herne Hill|High Wycombe|Highgate|Hilbert|Hillarys|Hillman|Hilton|Hocking|Huntingdale|Iluka|Inglewood|Innaloo|Jandakot|Jane Brook|Jindalee|Jolimont|Joondalup|Joondanna|Kalamunda|Kallaroo|Karawara|Kardinya|Karnup|Karrinyup|Kelmscott|Kensington|Kenwick|Kewdale|Kiara|Kingsley|Kinross|Koondoola|Koongamia|Kwinana|Landsdale|Langford|Lathlain|Leda|Leederville|Leeming|Lesmurdie|Lockridge|Lynwood|Maddington|Madeley|Mahogany Creek|Maida Vale|Mandurah|Manning|Marangaroo|Marmion|Martin|Maylands|Medina|Melville|Menora|Merriwa|Middle Swan|Midland|Midvale|Mindarie|Mirrabooka|Morley|Mosman Park|Mount Claremont|Mount Hawthorn|Mount Helena|Mount Lawley|Mount Nasura|Mount Pleasant|Mount Richon|Mullaloo|Mundaring|Mundijong|Munster|Murdoch|Myaree|Nedlands|Nollamara|Noranda|North Beach|North Coogee|North Fremantle|North Lake|North Perth|Northbridge|Oakford|Ocean Reef|Orelia|Osborne Park|Padbury|Palmyra|Parkerville|Parkwood|Parmelia|Pearsall|Peppermint Grove|Piara Waters|Pickering Brook|Port Kennedy|Queens Park|Quinns Rocks|Redcliffe|Ridgewood|Riverton|Rivervale|Rockingham|Roleystone|Rossmoyne|Safety Bay|Salter Point|Samson|Scarborough|Secret Harbour|Serpentine|Seville Grove|Shelley|Shenton Park|Shoalwater|Sinagra|Singleton|Sorrento|South Fremantle|South Guildford|South Lake|South Perth|Southern River|Spearwood|Stirling|Stoneville|Stratton|Subiaco|Success|Swan View|Swanbourne|Tapping|The Vines|Thornlie|Treeby|Trigg|Tuart Hill|Two Rocks|Upper Swan|Victoria Park|Viveash|Waikiki|Wandi|Wangara|Wanneroo|Warnbro|Warwick|Waterford|Watermans Bay|Wattle Grove|Wellard|Wembley|Wembley Downs|West Leederville|West Perth|West Swan|Westminster|White Gum Valley|Willagee|Willetton|Wilson|Winthrop|Woodbridge|Woodlands|Woodvale|Wooroloo|Yanchep|Yangebup|Yokine|Albany|Augusta|Australind|Boddington|Bridgetown|Broome|Bunbury|Busselton|Carnarvon|Collie|Dalyellup|Denmark|Derby|Dongara|Donnybrook|Dunsborough|Eaton|Esperance|Exmouth|Geraldton|Halls Creek|Harvey|Jurien Bay|Kalbarri|Kalgoorlie|Karratha|Katanning|Kununurra|Manjimup|Margaret River|Merredin|Moora|Narrogin|Newman|Northam|Pinjarra|Port Hedland|Tom Price|Toodyay|Waroona|York`
  .split('|');

// Names that are also first names, surnames or everyday words on their own are
// left to the people-matcher and the review card: hiding "Martin", "Wilson",
// "Shelley", "Stirling", "Success", "Hilton" or "York" as a SUBURB would be
// wrong far more often than right.
const AMBIGUOUS = new Set('Martin|Wilson|Shelley|Stirling|Success|Hilton|York|Ascot|Bedford|Bentley|Carlisle|Warwick|Denmark|Derby|Harvey|Newman|Eaton|Augusta|Melville|Murdoch|Samson|Haynes|Hilbert|Kensington|Westminster|Leda|Medina|Como|Iluka|Trigg'.split('|'));

const LIST = SUBURBS.filter((s) => !AMBIGUOUS.has(s));
const FIRST_WORDS = new Set(LIST.map((s) => s.split(' ')[0]));
const SET = new Set(LIST);

/** Spans of listed place names in text, longest first, capitals required. */
function suburbSpans(text) {
  const spans = [];
  const re = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const words = m[0].split(/\s+/);
    let advanced = false;
    for (let start = 0; start < words.length && !advanced; start++) {
      if (!FIRST_WORDS.has(words[start])) continue;
      for (let n = words.length - start; n >= 1; n--) {
        const cand = words.slice(start, start + n).join(' ');
        if (!SET.has(cand)) continue;
        const offset = m.index + words.slice(0, start).join(' ').length + (start ? 1 : 0);
        spans.push({ start: offset, end: offset + cand.length, role: 'suburb' });
        re.lastIndex = offset + cand.length; advanced = true; break;
      }
    }
  }
  return spans;
}

module.exports = { suburbSpans, SUBURBS: LIST, AMBIGUOUS };
