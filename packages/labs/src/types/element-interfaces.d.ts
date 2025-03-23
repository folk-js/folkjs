import { FolkArrow } from '../folk-arrow';
import { FolkHull } from '../folk-hull';
import { FolkHyperedge } from '../folk-hyperedge';
import { FolkInk } from '../folk-ink';
import { FolkLLM } from '../folk-llm';
import { FolkPinch } from '../folk-pinch';
import { FolkPresence } from '../folk-presence';
import { FolkProjector } from '../folk-projector';
import { FolkCluster, FolkProximity } from '../folk-proximity';
import { FolkRope } from '../folk-rope';
import { FolkShape } from '../folk-shape';
import { FolkShapeAttribute } from '../folk-shape-attribute';
import { FolkShapeOverlay } from '../folk-shape-overlay';
import { FolkShortcutTree } from '../folk-shortcut-tree';
import { FolkSpace } from '../folk-space';
import { FolkSpectrogram } from '../folk-spectrogram';
import { FolkSpreadsheet, FolkSpreadSheetCell, FolkSpreadsheetHeader } from '../folk-spreadsheet';
import { FolkWebLLM } from '../folk-webllm';
import { FolkZoomable } from '../folk-zoomable';
import { IntlNumber } from '../intl-elements/intl-number';

declare global {
  interface HTMLElementTagNameMap {
    'folk-arrow': FolkArrow;
    'folk-hull': FolkHull;
    'folk-hyperedge': FolkHyperedge;
    'folk-ink': FolkInk;
    'folk-llm': FolkLLM;
    'folk-pinch': FolkPinch;
    'folk-presence': FolkPresence;
    'folk-projector': FolkProjector;
    'folk-cluster': FolkCluster;
    'folk-proximity': FolkProximity;
    'folk-rope': FolkRope;
    'folk-shape-overlay': FolkShapeOverlay;
    'folk-shape': FolkShape;
    'folk-shortcut-tree': FolkShortcutTree;
    'folk-space': FolkSpace;
    'folk-spectrogram': FolkSpectrogram;
    'folk-spreadsheet': FolkSpreadsheet;
    'folk-webllm': FolkWebLLM;
    'intl-number': IntlNumber;
  }

  interface ElementAttributesMap {
    shape: FolkShapeAttribute | undefined;
    zoom: FolkZoomable | undefined;
  }

  interface ElementEventMap {
    'shape-connected': ShapeConnectedEvent;
    'shape-disconnected': ShapeDisconnectedEvent;
  }

  interface HTMLElementTagNameMap {
    's-header': FolkSpreadsheetHeader;
    'folk-cell': FolkSpreadSheetCell;
  }
}
