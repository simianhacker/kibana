/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ControlGroupAPI } from '@kbn/controls-plugin/public';
import { QueryState, RefreshInterval, TimeRange } from '@kbn/data-plugin/common';
import type {
  DiscoverAppState,
  DiscoverStateContainer,
  DataDocumentsMsg,
} from '@kbn/discover-plugin/public';
import { DoneInvokeEvent } from 'xstate';
import type { DataTableRecord } from '@kbn/discover-utils/src/types';
import { ControlPanels, DisplayOptions } from '../../../../common';
import type {
  DatasetSelection,
  DataSourceSelection,
  DataViewSelection,
} from '../../../../common/data_source_selection';

export interface WithDataSourceSelection {
  dataSourceSelection: DataSourceSelection;
}

export interface WithControlPanelGroupAPI {
  controlGroupAPI: ControlGroupAPI;
}

export interface WithControlPanels {
  controlPanels?: ControlPanels;
}

export type WithQueryState = QueryState;

export type WithDisplayOptions = DisplayOptions;

export interface WithDiscoverStateContainer {
  discoverStateContainer: DiscoverStateContainer;
}

export interface WithDataTableRecord {
  rows: DataTableRecord[];
}

export type DefaultLogsExplorerControllerState = WithDataSourceSelection &
  WithQueryState &
  WithDisplayOptions &
  WithDataTableRecord;

export type LogsExplorerControllerTypeState =
  | {
      value: 'uninitialized';
      context: WithDataSourceSelection & WithControlPanels & WithQueryState & WithDisplayOptions;
    }
  | {
      value: 'initializingSelection';
      context: WithDataSourceSelection &
        WithControlPanels &
        WithQueryState &
        WithDisplayOptions &
        WithDataTableRecord &
        WithDiscoverStateContainer;
    }
  | {
      value: 'initializingDataset';
      context: WithDataSourceSelection &
        WithControlPanels &
        WithQueryState &
        WithDisplayOptions &
        WithDiscoverStateContainer;
    }
  | {
      value: 'initializingDataView';
      context: WithDataSourceSelection &
        WithControlPanels &
        WithQueryState &
        WithDisplayOptions &
        WithDiscoverStateContainer;
    }
  | {
      value: 'initializingControlPanels';
      context: WithDataSourceSelection &
        WithControlPanels &
        WithQueryState &
        WithDisplayOptions &
        WithDiscoverStateContainer;
    }
  | {
      value: 'initialized';
      context: WithDataSourceSelection &
        WithControlPanels &
        WithQueryState &
        WithDisplayOptions &
        WithDataTableRecord &
        WithDiscoverStateContainer;
    }
  | {
      value: 'initialized.dataSourceSelection.idle';
      context: WithDataSourceSelection &
        WithControlPanels &
        WithQueryState &
        WithDisplayOptions &
        WithDataTableRecord &
        WithDiscoverStateContainer;
    }
  | {
      value: 'initialized.dataSourceSelection.changingDataView';
      context: WithDataSourceSelection &
        WithControlPanels &
        WithQueryState &
        WithDisplayOptions &
        WithDataTableRecord &
        WithDiscoverStateContainer;
    }
  | {
      value: 'initialized.dataSourceSelection.creatingAdHocDataView';
      context: WithDataSourceSelection &
        WithControlPanels &
        WithQueryState &
        WithDisplayOptions &
        WithDataTableRecord &
        WithDiscoverStateContainer;
    }
  | {
      value: 'initialized.controlGroups.uninitialized';
      context: WithDataSourceSelection &
        WithControlPanels &
        WithQueryState &
        WithDisplayOptions &
        WithDataTableRecord &
        WithDiscoverStateContainer;
    }
  | {
      value: 'initialized.controlGroups.idle';
      context: WithDataSourceSelection &
        WithControlPanelGroupAPI &
        WithControlPanels &
        WithQueryState &
        WithDisplayOptions &
        WithDataTableRecord &
        WithDiscoverStateContainer;
    }
  | {
      value: 'initialized.controlGroups.updatingControlPanels';
      context: WithDataSourceSelection &
        WithControlPanelGroupAPI &
        WithControlPanels &
        WithQueryState &
        WithDisplayOptions &
        WithDataTableRecord &
        WithDiscoverStateContainer;
    };

export type LogsExplorerControllerContext = LogsExplorerControllerTypeState['context'];

export type LogsExplorerControllerEvent =
  | {
      type: 'RECEIVED_STATE_CONTAINER';
      discoverStateContainer: DiscoverStateContainer;
    }
  | {
      type: 'DATASET_SELECTION_RESTORE_FAILURE';
    }
  | {
      type: 'INITIALIZE_DATA_VIEW';
      data?: DataViewSelection;
    }
  | {
      type: 'INITIALIZE_DATASET';
      data?: DatasetSelection;
    }
  | {
      type: 'UPDATE_DATA_SOURCE_SELECTION';
      data: DataSourceSelection;
    }
  | {
      type: 'INITIALIZE_CONTROL_GROUP_API';
      controlGroupAPI: ControlGroupAPI | undefined;
    }
  | {
      type: 'UPDATE_CONTROL_PANELS';
      controlPanels: ControlPanels | null;
    }
  | {
      type: 'RECEIVE_DISCOVER_APP_STATE';
      appState: DiscoverAppState;
    }
  | {
      type: 'RECEIVE_DISCOVER_DATA_STATE';
      dataState: DataDocumentsMsg['result'];
    }
  | {
      type: 'RECEIVE_TIMEFILTER_TIME';
      time: TimeRange;
    }
  | {
      type: 'RECEIVE_TIMEFILTER_REFRESH_INTERVAL';
      refreshInterval: RefreshInterval;
    }
  | DoneInvokeEvent<DataSourceSelection>
  | DoneInvokeEvent<ControlPanels>
  | DoneInvokeEvent<ControlGroupAPI>
  | DoneInvokeEvent<Error>;
