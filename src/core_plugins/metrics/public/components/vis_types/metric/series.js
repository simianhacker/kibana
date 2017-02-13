import React, { Component, PropTypes } from 'react';
import _ from 'lodash';
import ColorPicker from '../../color_picker';
import AddDeleteButtons from '../../add_delete_buttons';
import SeriesConfig from '../../series_config';
import Sortable from 'react-anything-sortable';
import Split from '../../split';
import Tooltip from '../../tooltip';
import createAggRowRender from '../../lib/create_agg_row_render';
import createTextHandler from '../../lib/create_text_handler';

function MetricSeries(props) {
  const {
    model,
    panel,
    fields,
    onAdd,
    onChange,
    onDelete,
    disableDelete,
    disableAdd,
    selectedTab,
    visible
  } = props;

  const handleChange = createTextHandler(onChange);
  const aggs = model.metrics.map(createAggRowRender(props));

  let caretClassName = 'fa fa-caret-down';
  if (!visible) caretClassName = 'fa fa-caret-right';

  let body = (<div style={{ display: 'none' }}/>);
  if (visible) {
    let metricsClassName = 'kbnTabs__tab';
    let optionsClassname = 'kbnTabs__tab';
    if (selectedTab === 'metrics') metricsClassName += '-active';
    if (selectedTab === 'options') optionsClassname += '-active';
    let seriesBody;
    if (selectedTab === 'metrics') {
      const handleSort = (data) => {
        const metrics = data.map(id => model.metrics.find(m => m.id === id));
        props.onChange({ metrics });
      };
      seriesBody = (
        <div>
          <Sortable
            style={{ cursor: 'default' }}
            dynamic={true}
            direction="vertical"
            onSort={handleSort}
            sortHandle="vis_editor__agg_sort">
            { aggs }
          </Sortable>
          <div className="vis_editor__agg_row">
            <div className="vis_editor__agg_row-item">
              <Split
                onChange={props.onChange}
                fields={fields}
                panel={panel}
                model={model}/>
            </div>
          </div>
        </div>
      );
    } else {
      seriesBody = (
        <SeriesConfig
          fields={props.fields}
          model={props.model}
          onChange={props.onChange} />
      );
    }
    body = (
      <div className="vis_editor__series-row">
        <div className="kbnTabs sm">
          <div className={metricsClassName}
            onClick={e => props.switchTab('metrics')}>Metrics</div>
          <div className={optionsClassname}
            onClick={e => props.switchTab('options')}>Options</div>
        </div>
        {seriesBody}
      </div>
    );
  }

  let colorPicker;
  if (props.colorPicker) {
    colorPicker = (
      <ColorPicker
        disableTrash={true}
        onChange={props.onChange}
        name="color"
        value={model.color}/>
    );
  }

  let dragHandle;
  if (!props.disableDelete) {
    dragHandle = (
      <Tooltip text="Sort">
        <div className="vis_editor__sort thor__button-outlined-default sm">
          <i className="fa fa-sort"></i>
        </div>
      </Tooltip>
    );
  }

  return (
    <div
      className={`${props.className} vis_editor__series`}
      style={props.style}
      onMouseDown={props.onMouseDown}
      onTouchStart={props.onTouchStart}>
      <div className="vis_editor__container">
        <div className="vis_editor__series-details">
          <div onClick={ props.toggleVisible }><i className={ caretClassName }/></div>
          { colorPicker }
          <div className="vis_editor__row_item" style={{ display: 'flex' }}>
            <input
              className="vis_editor__input-grows"
              onChange={handleChange('label')}
              placeholder='Label'
              value={model.label}/>
          </div>
          { dragHandle }
          <AddDeleteButtons
            onDelete={onDelete}
            onClone={props.onClone}
            onAdd={onAdd}
            disableDelete={disableDelete}
            disableAdd={disableAdd}/>
        </div>
      </div>
      { body }
    </div>
  );

}

MetricSeries.propTypes = {
  className: PropTypes.string,
  colorPicker: PropTypes.bool,
  disableAdd: PropTypes.bool,
  disableDelete: PropTypes.bool,
  fields: PropTypes.object,
  name: PropTypes.string,
  onAdd: PropTypes.func,
  onChange: PropTypes.func,
  onClone: PropTypes.func,
  onDelete: PropTypes.func,
  onMouseDown: PropTypes.func,
  onSortableItemMount: PropTypes.func,
  onSortableItemReadyToMove: PropTypes.func,
  onTouchStart: PropTypes.func,
  model: PropTypes.object,
  panel: PropTypes.object,
  selectedTab: PropTypes.string,
  sortData: PropTypes.string,
  style: PropTypes.object,
  switchTab: PropTypes.func,
  toggleVisible: PropTypes.func,
  visible: PropTypes.bool
};

export default MetricSeries;
