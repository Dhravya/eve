import { decisionTool } from "@eve/typesafe";

import { typesafeFetch } from "../testing";

export default decisionTool({ apiKey: "fixture-key", fetch: typesafeFetch });
