/** Read the configuration from generator/config/ (Node only). */
import {readFileSync} from "node:fs";
import {readCollection, type Collection} from "./collection";
import {buildConfig} from "./config";
import {fromRoot} from "./paths";
import type {GeneratorConfig} from "./types";

const readJson = (relativePath: string): unknown => JSON.parse(readFileSync(fromRoot(relativePath), "utf8"));

export function loadConfig(): GeneratorConfig {
  return buildConfig({
    baseTemplates: readJson("config/base-templates.json"),
    traits: readJson("config/traits.json"),
    compatibility: readJson("config/compatibility.json"),
    layout: readJson("config/layout.json")
  });
}

export function loadCollection(): Collection {
  return readCollection(readJson("config/collection.json"));
}
