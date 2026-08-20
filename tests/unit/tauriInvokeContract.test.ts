import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type RustCommand = {
  name: string;
  argumentKeys: string[];
};

type FrontendInvoke = {
  command: string;
  argumentKeys: string[];
  line: number;
};

const readProjectFile = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const snakeToLowerCamel = (value: string): string =>
  value.replace(/_([a-z\d])/gu, (_, character: string) => character.toUpperCase());

const findClosingDelimiter = (source: string, start: number, open: string, close: string): number => {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === open) depth += 1;
    if (source[index] === close) depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error(`Unclosed ${open} at offset ${start}`);
};

const splitTopLevel = (source: string): string[] => {
  const parts: string[] = [];
  let start = 0;
  let angleDepth = 0;
  let roundDepth = 0;
  let squareDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "<") angleDepth += 1;
    if (character === ">") angleDepth -= 1;
    if (character === "(") roundDepth += 1;
    if (character === ")") roundDepth -= 1;
    if (character === "[") squareDepth += 1;
    if (character === "]") squareDepth -= 1;
    if (character === "," && angleDepth === 0 && roundDepth === 0 && squareDepth === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(source.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
};

const isTauriInjectedParameter = (rustType: string): boolean =>
  /^(?:&\s*)?(?:tauri::)?(?:State|AppHandle|Window|WebviewWindow|Request|Channel)\b/u.test(
    rustType.trim()
  );

const extractRustCommands = (source: string): RustCommand[] => {
  const commands: RustCommand[] = [];
  const commandPattern = /#\[tauri::command(?:\([^\]]*\))?\]\s*(?:pub\s+)?fn\s+([a-zA-Z\d_]+)\s*/gu;

  for (const match of source.matchAll(commandPattern)) {
    const name = match[1];
    if (!name || match.index === undefined) continue;

    const signatureStart = match.index + match[0].length;
    const parametersStart = source.indexOf("(", signatureStart);
    if (parametersStart < 0) throw new Error(`Missing parameter list for Rust command ${name}`);
    const parametersEnd = findClosingDelimiter(source, parametersStart, "(", ")");
    const parameters = splitTopLevel(source.slice(parametersStart + 1, parametersEnd));
    const argumentKeys = parameters.flatMap((parameter) => {
      const separator = parameter.indexOf(":");
      if (separator < 0) throw new Error(`Unparseable parameter in Rust command ${name}: ${parameter}`);
      const parameterName = parameter.slice(0, separator).trim().replace(/^mut\s+/u, "");
      const rustType = parameter.slice(separator + 1).trim();
      return isTauriInjectedParameter(rustType) ? [] : [snakeToLowerCamel(parameterName)];
    });

    commands.push({ name, argumentKeys });
  }

  return commands;
};

const extractRegisteredCommands = (source: string): Set<string> => {
  const handlerStart = source.indexOf("tauri::generate_handler![");
  if (handlerStart < 0) throw new Error("Tauri generate_handler registration was not found");
  const listStart = source.indexOf("[", handlerStart);
  const listEnd = findClosingDelimiter(source, listStart, "[", "]");
  return new Set(
    source
      .slice(listStart + 1, listEnd)
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
  );
};

const propertyName = (name: ts.PropertyName): string => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  throw new Error(`Computed invoke argument keys are not contract-checkable: ${name.getText()}`);
};

const extractInvokeArgumentKeys = (argument: ts.Expression | undefined): string[] => {
  if (!argument) return [];
  if (!ts.isObjectLiteralExpression(argument)) {
    throw new Error(`invoke arguments must use an inline object literal: ${argument.getText()}`);
  }

  return argument.properties.map((property) => {
    if (ts.isPropertyAssignment(property)) return propertyName(property.name);
    if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
    throw new Error(`Unsupported invoke argument property: ${property.getText()}`);
  });
};

const extractFrontendInvokes = (source: string): FrontendInvoke[] => {
  const sourceFile = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const invokes: FrontendInvoke[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "invoke"
    ) {
      const commandArgument = node.arguments[0];
      if (!commandArgument || !ts.isStringLiteral(commandArgument)) {
        throw new Error(`invoke command must be a string literal: ${node.getText()}`);
      }
      invokes.push({
        command: commandArgument.text,
        argumentKeys: extractInvokeArgumentKeys(node.arguments[1]),
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return invokes;
};

describe("Tauri invoke contract", () => {
  it("keeps every App invoke registered and aligned with Rust's lowerCamelCase argument contract", () => {
    const appSource = readProjectFile("src/App.tsx");
    const commandsSource = readProjectFile("src-tauri/src/commands.rs");
    const mainSource = readProjectFile("src-tauri/src/main.rs");
    const registeredCommands = extractRegisteredCommands(mainSource);
    const rustCommands = new Map(
      [...extractRustCommands(commandsSource), ...extractRustCommands(mainSource)].map((command) => [
        command.name,
        command
      ])
    );
    const invokes = extractFrontendInvokes(appSource);

    expect(invokes.length).toBeGreaterThan(0);
    for (const frontendInvoke of invokes) {
      const context = `${frontendInvoke.command} at src/App.tsx:${frontendInvoke.line}`;
      expect(registeredCommands.has(frontendInvoke.command), `${context} is not registered`).toBe(true);

      const rustCommand = rustCommands.get(frontendInvoke.command);
      expect(rustCommand, `${context} has no #[tauri::command] function`).toBeDefined();
      expect(
        [...frontendInvoke.argumentKeys].sort(),
        `${context} arguments diverge from the Rust command signature`
      ).toEqual([...(rustCommand?.argumentKeys ?? [])].sort());
    }
  });
});
