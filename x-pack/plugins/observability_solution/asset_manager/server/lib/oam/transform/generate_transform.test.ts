/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { oamDefinition } from '../helpers/fixtures/oam_definition';
import { generateTransform } from './generate_transform';

describe('generateTransform(definition)', () => {
  it('should generate a valid summary transform', () => {
    const transform = generateTransform(oamDefinition);
    expect(transform).toMatchSnapshot();
  });
});
