/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { IToasts } from '@kbn/core-notifications-browser';
import { DatasetQualityPluginStart } from '@kbn/dataset-quality-plugin/public';
import { DatasetQualityDetailsController } from '@kbn/dataset-quality-plugin/public/controller/dataset_quality_details';
import { IKbnUrlStateStorage } from '@kbn/kibana-utils-plugin/public';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import type { ChromeBreadcrumb } from '@kbn/core-chrome-browser';
import { useKibanaContextForPlugin } from '../../utils/use_kibana';
import { getBreadcrumbValue, useBreadcrumbs } from '../../utils/use_breadcrumbs';
import {
  getDatasetQualityDetailsStateFromUrl,
  updateUrlFromDatasetQualityDetailsState,
} from './url_state_storage_service';
import { PLUGIN_ID, PLUGIN_NAME } from '../../../common';

const DatasetQualityDetailsContext = createContext<{
  controller?: DatasetQualityDetailsController;
}>({});

interface ContextProps {
  children: JSX.Element;
  urlStateStorageContainer: IKbnUrlStateStorage;
  toastsService: IToasts;
  datasetQuality: DatasetQualityPluginStart;
}

export function DatasetQualityDetailsContextProvider({
  children,
  urlStateStorageContainer,
  toastsService,
  datasetQuality,
}: ContextProps) {
  const [controller, setController] = useState<DatasetQualityDetailsController>();
  const history = useHistory();
  const {
    services: {
      chrome,
      appParams,
      application: { navigateToApp },
    },
  } = useKibanaContextForPlugin();
  const rootBreadCrumb = useMemo(
    () => ({
      text: PLUGIN_NAME,
      onClick: () => navigateToApp('management', { path: `/data/${PLUGIN_ID}` }),
    }),
    [navigateToApp]
  );
  const [breadcrumbs, setBreadcrumbs] = useState<ChromeBreadcrumb[]>([rootBreadCrumb]);

  useEffect(() => {
    async function getDatasetQualityDetailsController() {
      const initialState = getDatasetQualityDetailsStateFromUrl({
        urlStateStorageContainer,
        toastsService,
      });

      // state initialization is under progress
      if (initialState === undefined) {
        return;
      }

      // state initialized but empty
      if (initialState === null) {
        history.push('/');
        return;
      }

      const datasetQualityDetailsController =
        await datasetQuality.createDatasetQualityDetailsController({
          initialState,
        });
      datasetQualityDetailsController.service.start();

      // TODO: Work on this
      // if (initialState?.expandedDegradedField) {
      //   datasetQualityDetailsController.service.send({
      //     type: 'OPEN_DEGRADED_FIELD_FLYOUT',
      //     fieldName: initialState.expandedDegradedField,
      //   });
      // }

      setController(datasetQualityDetailsController);

      const datasetQualityStateSubscription = datasetQualityDetailsController.state$.subscribe(
        (state) => {
          updateUrlFromDatasetQualityDetailsState({
            urlStateStorageContainer,
            datasetQualityDetailsState: state,
          });
          const breadcrumbValue = getBreadcrumbValue(state.dataStream, state.integration);
          setBreadcrumbs([rootBreadCrumb, { text: breadcrumbValue }]);
        }
      );

      return () => {
        datasetQualityDetailsController.service.stop();
        datasetQualityStateSubscription.unsubscribe();
      };
    }

    getDatasetQualityDetailsController();
  }, [datasetQuality, history, rootBreadCrumb, toastsService, urlStateStorageContainer]);

  useBreadcrumbs(breadcrumbs, appParams, chrome);

  return (
    <DatasetQualityDetailsContext.Provider value={{ controller }}>
      {children}
    </DatasetQualityDetailsContext.Provider>
  );
}

export const useDatasetQualityDetailsContext = () => {
  const context = useContext(DatasetQualityDetailsContext);
  if (context === undefined) {
    throw new Error(
      'useDatasetQualityDetailContext must be used within a <DatasetQualityDetailsContextProvider />'
    );
  }
  return context;
};
