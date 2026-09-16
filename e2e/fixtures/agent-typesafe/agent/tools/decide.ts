import { decisionTool } from "eve/experimental/typesafe";

import { typesafeFetch } from "../testing";

export default decisionTool({ apiKey: "fixture-key", fetch: typesafeFetch });
