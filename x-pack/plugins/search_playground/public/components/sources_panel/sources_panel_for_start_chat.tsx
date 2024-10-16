/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiFlexGroup, EuiFlexItem, EuiLoadingSpinner, EuiCallOut } from '@elastic/eui';
import React, { useState, useEffect } from 'react';
import { i18n } from '@kbn/i18n';
import { useController } from 'react-hook-form';
import { AddIndicesField } from './add_indices_field';
import { IndicesTable } from './indices_table';
import { StartChatPanel } from '../start_chat_panel';
import { CreateIndexCallout } from './create_index_callout';
import { useSourceIndicesField } from '../../hooks/use_source_indices_field';
import { useQueryIndices } from '../../hooks/use_query_indices';
import { ChatFormFields } from '../../types';
import { useIndicesFields } from '../../hooks/use_indices_fields';
import {
  createQuery,
  getDefaultQueryFields,
  getDefaultSourceFields,
  IndexFields,
} from '../../utils/create_query';

const transformToErrorMessage = (defaultSourceFields: IndexFields): string | undefined => {
  const indices: string[] = [];
  Object.keys(defaultSourceFields).forEach((index: string) => {
    if (defaultSourceFields[index][0] === undefined) {
      indices.push(index);
    }
  });

  return indices.length === 0 ? undefined : indices.join();
};

export const SourcesPanelForStartChat: React.FC = () => {
  const { selectedIndices, removeIndex, addIndex } = useSourceIndicesField();
  const { indices, isLoading } = useQueryIndices();
  const { fields } = useIndicesFields(selectedIndices || []);
  const [sourceFieldErrorMessage, setSourceFieldErrorMessage] = useState<string>();

  const {
    field: { onChange: elasticsearchQueryOnChange },
  } = useController({
    name: ChatFormFields.elasticsearchQuery,
    defaultValue: {},
  });

  const {
    field: { onChange: sourceFieldsOnChange },
  } = useController({
    name: ChatFormFields.sourceFields,
    defaultValue: {},
  });

  useEffect(() => {
    if (fields) {
      const defaultFields = getDefaultQueryFields(fields);
      elasticsearchQueryOnChange(createQuery(defaultFields, fields));
      const defaultSourceFields = getDefaultSourceFields(fields);
      sourceFieldsOnChange(defaultSourceFields);
      setSourceFieldErrorMessage(transformToErrorMessage(defaultSourceFields));
    }
  }, [fields, elasticsearchQueryOnChange, sourceFieldsOnChange]);

  return (
    <StartChatPanel
      title={i18n.translate('xpack.searchPlayground.emptyPrompts.sources.title', {
        defaultMessage: 'Select sources',
      })}
      description={i18n.translate('xpack.searchPlayground.emptyPrompts.sources.description', {
        defaultMessage: 'Where should the data for this chat experience be retrieved from?',
      })}
      isValid={!!selectedIndices.length}
    >
      {!!selectedIndices?.length && (
        <EuiFlexItem>
          <IndicesTable indices={selectedIndices} onRemoveClick={removeIndex} />
        </EuiFlexItem>
      )}

      {sourceFieldErrorMessage && (
        <EuiCallOut color="warning" iconType="warning">
          <p>
            {i18n.translate('xpack.searchPlayground.emptyPrompts.sources.warningCallout', {
              defaultMessage: 'No source fields found for {errorMessage}',
              values: {
                errorMessage: sourceFieldErrorMessage,
              },
            })}
          </p>
        </EuiCallOut>
      )}

      {isLoading && (
        <EuiFlexGroup justifyContent="center" alignItems="center">
          <EuiLoadingSpinner size="l" />
        </EuiFlexGroup>
      )}

      {!isLoading && !!indices?.length && (
        <EuiFlexItem>
          <AddIndicesField selectedIndices={selectedIndices} onIndexSelect={addIndex} />
        </EuiFlexItem>
      )}

      {!isLoading && !indices?.length && <CreateIndexCallout />}
    </StartChatPanel>
  );
};
