import React, { Component, PropTypes } from 'react';
import _ from 'lodash';
import AggSelect from './agg_select';
import MetricSelect from './metric_select';
import AggRow from './agg_row';
import createChangeHandler from '../lib/create_change_handler';
import createSelectHandler from '../lib/create_select_handler';
import createNumberHandler from '../lib/create_number_handler';

class SerialDiffAgg extends Component {

  render() {
    const { model, siblings, panel } = this.props;

    const handleChange = createChangeHandler(this.props.onChange, model);
    const handleSelectChange = createSelectHandler(handleChange);
    const handleNumberChange = createNumberHandler(handleChange);

    return (
      <AggRow
        disableDelete={this.props.disableDelete}
        model={this.props.model}
        onAdd={this.props.onAdd}
        onDelete={this.props.onDelete}
        siblings={this.props.siblings}>
        <div className="vis_editor__row_item">
          <div className="vis_editor__label">Aggregation</div>
          <AggSelect
            siblings={this.props.siblings}
            panelType={panel.type}
            value={model.type}
            onChange={handleSelectChange('type')}/>
        </div>
        <div className="vis_editor__row_item">
          <div className="vis_editor__label">Metric</div>
          <MetricSelect
            onChange={handleSelectChange('field')}
            metrics={siblings}
            metric={model}
            value={model.field}/>
        </div>
        <div>
          <div className="vis_editor__label">Lag</div>
          <input
            className="vis_editor__input"
            onChange={handleNumberChange('lag')}
            value={model.lag}
            type="text"/>
        </div>
      </AggRow>
    );
  }

}

SerialDiffAgg.propTypes = {
  disableDelete: PropTypes.bool,
  fields: PropTypes.object,
  model: PropTypes.object,
  onAdd: PropTypes.func,
  onChange: PropTypes.func,
  onDelete: PropTypes.func,
  panel: PropTypes.object,
  series: PropTypes.object,
  siblings: PropTypes.array,
};

export default SerialDiffAgg;

