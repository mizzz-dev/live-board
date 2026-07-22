import {
  cloneLayer,
  cloneLayerDocument,
  findLayer,
  getLayerDocument,
  type ImageLayer,
  type Layer,
  type LayerId,
  type ShapeLayer,
  type TextLayer,
} from './layers.js';
import {
  findPage,
  findProject,
  replaceProject,
  type Page,
  type PageId,
  type Project,
  type ProjectId,
} from './model.js';
import {
  getLayerHistory,
  type LayerHistoryEntry,
} from './layer-history.js';
import type { CanvasWorkspaceCommandState } from './canvas-state.js';

export interface RichTextContent {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  color: string;
  strokeColor: string | null;
  strokeWidth: number;
  shadowColor: string | null;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  maxWidth: number | null;
}

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RichImageContent {
  assetId: string | null;
  width: number;
  height: number;
  crop: ImageCrop;
  flipX: boolean;
  flipY: boolean;
}

export interface RichShapeContent {
  shape: 'rectangle' | 'ellipse' | 'line';
  width: number;
  height: number;
  cornerRadius: number;
  fill: string | null;
  stroke: string;
  strokeWidth: number;
}

export interface LayerContentCommandMetadata {
  commandId: string;
  createdAt: string;
}

export interface UpdateLayerContentCommand extends LayerContentCommandMetadata {
  type: 'layer.content.update';
  projectId: ProjectId;
  pageId: PageId;
  layerId: LayerId;
  content: RichTextContent | RichImageContent | RichShapeContent;
}

export function getRichTextContent(layer: TextLayer): RichTextContent {
  const content = layer.content as TextLayer['content'] & Partial<RichTextContent>;
  return validateTextContent({
    text: content.text,
    fontFamily: content.fontFamily,
    fontSize: content.fontSize,
    fontWeight: content.fontWeight ?? 400,
    fontStyle: content.fontStyle ?? 'normal',
    align: content.align ?? 'left',
    lineHeight: content.lineHeight ?? 1.2,
    color: content.color,
    strokeColor: content.strokeColor ?? null,
    strokeWidth: content.strokeWidth ?? 0,
    shadowColor: content.shadowColor ?? null,
    shadowBlur: content.shadowBlur ?? 0,
    shadowOffsetX: content.shadowOffsetX ?? 0,
    shadowOffsetY: content.shadowOffsetY ?? 0,
    maxWidth: content.maxWidth ?? null,
  });
}

export function getRichImageContent(layer: ImageLayer): RichImageContent {
  const content = layer.content as ImageLayer['content'] & Partial<RichImageContent>;
  return validateImageContent({
    assetId: content.assetId,
    width: content.width,
    height: content.height,
    crop: content.crop ?? { x: 0, y: 0, width: content.width, height: content.height },
    flipX: content.flipX ?? false,
    flipY: content.flipY ?? false,
  });
}

export function getRichShapeContent(layer: ShapeLayer): RichShapeContent {
  const content = layer.content as ShapeLayer['content'] & Partial<RichShapeContent>;
  return validateShapeContent({
    shape: content.shape,
    width: content.width ?? 240,
    height: content.height ?? 160,
    cornerRadius: content.cornerRadius ?? 0,
    fill: content.fill,
    stroke: content.stroke,
    strokeWidth: content.strokeWidth,
  });
}

export function withRichTextContent(layer: TextLayer, patch: Partial<RichTextContent>): TextLayer {
  const content = validateTextContent({ ...getRichTextContent(layer), ...patch });
  return { ...layer, content } as TextLayer;
}

export function withRichImageContent(layer: ImageLayer, patch: Partial<RichImageContent>): ImageLayer {
  const current = getRichImageContent(layer);
  const content = validateImageContent({ ...current, ...patch, crop: patch.crop ?? current.crop });
  return { ...layer, content } as ImageLayer;
}

export function withRichShapeContent(layer: ShapeLayer, patch: Partial<RichShapeContent>): ShapeLayer {
  const content = validateShapeContent({ ...getRichShapeContent(layer), ...patch });
  return { ...layer, content } as ShapeLayer;
}

export function createUpdateLayerContentCommand(
  projectId: ProjectId,
  pageId: PageId,
  layerId: LayerId,
  content: RichTextContent | RichImageContent | RichShapeContent,
  metadata: LayerContentCommandMetadata,
): UpdateLayerContentCommand {
  return {
    type: 'layer.content.update',
    projectId,
    pageId,
    layerId,
    content: cloneRichContent(content),
    ...metadata,
  };
}

export function dispatchLayerContentCommand(
  state: CanvasWorkspaceCommandState,
  command: UpdateLayerContentCommand,
): CanvasWorkspaceCommandState {
  const project = findProject(state.workspace, command.projectId);
  const page = findPage(project, command.pageId);
  const beforePage = clonePage(page);
  const document = getLayerDocument(page);
  const layer = findLayer(document, command.layerId);
  if (layer.editLocked) throw new Error(`Layer is locked: ${layer.id}`);

  const updatedLayer = updateContent(layer, command.content, command.createdAt);
  const afterPage: Page = {
    ...page,
    updatedAt: command.createdAt,
    layerDocument: {
      ...document,
      layers: document.layers.map((candidate) =>
        candidate.id === updatedLayer.id ? cloneLayer(updatedLayer) : candidate,
      ),
    },
  };
  const nextProject: Project = {
    ...project,
    updatedAt: command.createdAt,
    pages: project.pages.map((candidate) =>
      candidate.id === afterPage.id ? clonePage(afterPage) : candidate,
    ),
  };
  const workspace = replaceProject(state.workspace, nextProject, command.createdAt);
  const entry: LayerHistoryEntry = {
    historyId: `layer-history:${command.commandId}`,
    command: command as never,
    beforePage,
    afterPage: clonePage(afterPage),
    estimatedBytes: utf8ByteLength(JSON.stringify({ command, before: beforePage.layerDocument, after: afterPage.layerDocument })),
  };
  const stack = getLayerHistory(state, command.pageId);
  return {
    ...state,
    workspace,
    layerHistories: {
      ...state.layerHistories,
      [command.pageId]: {
        past: [...stack.past, entry].slice(-state.historyLimit),
        future: [],
      },
    },
  };
}

export function getLayerLocalBounds(layer: Layer): { x: number; y: number; width: number; height: number } {
  if (layer.type === 'image') {
    const content = getRichImageContent(layer);
    return { x: 0, y: 0, width: content.width, height: content.height };
  }
  if (layer.type === 'shape') {
    const content = getRichShapeContent(layer);
    return { x: 0, y: 0, width: content.width, height: content.height };
  }
  if (layer.type === 'text') {
    const content = getRichTextContent(layer);
    const lines = content.text.split(/\r?\n/);
    const longest = Math.max(1, ...lines.map((line) => [...line].length));
    const width = content.maxWidth ?? longest * content.fontSize * 0.65;
    const height = Math.max(1, lines.length) * content.fontSize * content.lineHeight;
    return { x: 0, y: 0, width, height };
  }
  return { x: 0, y: 0, width: 240, height: 160 };
}

function updateContent(
  layer: Layer,
  content: RichTextContent | RichImageContent | RichShapeContent,
  updatedAt: string,
): Layer {
  if (layer.type === 'text') {
    return { ...layer, content: validateTextContent(content as RichTextContent), updatedAt } as TextLayer;
  }
  if (layer.type === 'image') {
    return { ...layer, content: validateImageContent(content as RichImageContent), updatedAt } as ImageLayer;
  }
  if (layer.type === 'shape') {
    return { ...layer, content: validateShapeContent(content as RichShapeContent), updatedAt } as ShapeLayer;
  }
  throw new Error(`Layer content cannot be updated: ${layer.id}`);
}

function validateTextContent(input: RichTextContent): RichTextContent {
  if (typeof input.text !== 'string' || input.text.length > 100_000) throw new Error('INVALID_TEXT_CONTENT');
  if (input.fontFamily.trim().length < 1 || input.fontFamily.length > 200) throw new Error('INVALID_TEXT_FONT');
  if (!finiteRange(input.fontSize, 1, 2_000)) throw new Error('INVALID_TEXT_FONT_SIZE');
  if (!Number.isInteger(input.fontWeight) || input.fontWeight < 100 || input.fontWeight > 900 || input.fontWeight % 100 !== 0) throw new Error('INVALID_TEXT_FONT_WEIGHT');
  if (input.fontStyle !== 'normal' && input.fontStyle !== 'italic') throw new Error('INVALID_TEXT_FONT_STYLE');
  if (!['left', 'center', 'right'].includes(input.align)) throw new Error('INVALID_TEXT_ALIGN');
  if (!finiteRange(input.lineHeight, 0.5, 4)) throw new Error('INVALID_TEXT_LINE_HEIGHT');
  assertColor(input.color, false);
  assertColor(input.strokeColor, true);
  assertColor(input.shadowColor, true);
  if (!finiteRange(input.strokeWidth, 0, 100)) throw new Error('INVALID_TEXT_STROKE');
  if (!finiteRange(input.shadowBlur, 0, 500)) throw new Error('INVALID_TEXT_SHADOW');
  if (!finiteRange(input.shadowOffsetX, -10_000, 10_000) || !finiteRange(input.shadowOffsetY, -10_000, 10_000)) throw new Error('INVALID_TEXT_SHADOW_OFFSET');
  if (input.maxWidth !== null && !finiteRange(input.maxWidth, 1, 32_768)) throw new Error('INVALID_TEXT_MAX_WIDTH');
  return { ...input, fontFamily: input.fontFamily.trim() };
}

function validateImageContent(input: RichImageContent): RichImageContent {
  if (input.assetId !== null && !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/.test(input.assetId)) throw new Error('INVALID_IMAGE_ASSET_ID');
  if (!finiteRange(input.width, 1, 32_768) || !finiteRange(input.height, 1, 32_768)) throw new Error('INVALID_IMAGE_DIMENSIONS');
  const crop = { ...input.crop };
  if (!finiteRange(crop.x, 0, input.width) || !finiteRange(crop.y, 0, input.height) || !finiteRange(crop.width, 1, input.width) || !finiteRange(crop.height, 1, input.height) || crop.x + crop.width > input.width || crop.y + crop.height > input.height) {
    throw new Error('INVALID_IMAGE_CROP');
  }
  return { ...input, crop };
}

function validateShapeContent(input: RichShapeContent): RichShapeContent {
  if (!['rectangle', 'ellipse', 'line'].includes(input.shape)) throw new Error('INVALID_SHAPE_TYPE');
  if (!finiteRange(input.width, 1, 32_768) || !finiteRange(input.height, 1, 32_768)) throw new Error('INVALID_SHAPE_DIMENSIONS');
  if (!finiteRange(input.cornerRadius, 0, Math.min(input.width, input.height) / 2)) throw new Error('INVALID_SHAPE_RADIUS');
  assertColor(input.fill, true);
  assertColor(input.stroke, false);
  if (!finiteRange(input.strokeWidth, 0.1, 1_000)) throw new Error('INVALID_SHAPE_STROKE');
  return { ...input };
}

function cloneRichContent<T extends RichTextContent | RichImageContent | RichShapeContent>(content: T): T {
  return ('crop' in content ? { ...content, crop: { ...content.crop } } : { ...content }) as T;
}

function clonePage(page: Page): Page {
  return {
    ...page,
    ...(page.layerDocument === undefined ? {} : { layerDocument: cloneLayerDocument(page.layerDocument) }),
  };
}

function assertColor(value: string | null, nullable: boolean): void {
  if (value === null && nullable) return;
  if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(value)) throw new Error('INVALID_LAYER_COLOR');
}

function finiteRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
