import type { FolkEventPropagator } from 'src/folk-event-propagator';
import type { FolkArrow } from '../folk-arrow';
import type { FolkHull } from '../folk-hull';
import type { FolkHyperedge } from '../folk-hyperedge';
import type { FolkInk } from '../folk-ink';
import type { FolkLLM } from '../folk-llm';
import type { FolkPresence } from '../folk-presence';
import type { FolkProjector } from '../folk-projector';
import type { FolkCluster, FolkProximity } from '../folk-proximity';
import type { FolkRope } from '../folk-rope';
import type { FolkShape } from '../folk-shape';
import type { FolkShapeAttribute } from '../folk-shape-attribute';
import type { FolkShapeOverlay } from '../folk-shape-overlay';
import type { FolkShortcutTree } from '../folk-shortcut-tree';
import type { FolkSpace } from '../folk-space';
import type { FolkSpaceAttribute } from '../folk-space-attribute';
import type { FolkSpectrogram } from '../folk-spectrogram';
import type { FolkSpreadsheet, FolkSpreadSheetCell, FolkSpreadsheetHeader } from '../folk-spreadsheet';
import type { FolkWebLLM } from '../folk-webllm';
import type { IntlNumber } from '../intl-elements/intl-number';

declare global {
  interface HTMLElementTagNameMap {
    'folk-arrow': FolkArrow;
    'folk-event-propagator': FolkEventPropagator;
    'folk-hull': FolkHull;
    'folk-hyperedge': FolkHyperedge;
    'folk-ink': FolkInk;
    'folk-llm': FolkLLM;
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
    zoom: FolkSpaceAttribute | undefined;
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
