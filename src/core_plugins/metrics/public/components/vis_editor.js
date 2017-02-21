import React, { Component, PropTypes } from 'react';
import VisEditorVisualization from './vis_editor_visualization';
import VisPicker from './vis_picker';
import PanelConfig from './panel_config';

class VisEditor extends Component {

  constructor(props) {
    super(props);
    this.state = { model: props.model };
  }

  render() {
    const handleChange = (part) => {
      const nextModel = { ...this.state.model, ...part };
      this.setState({ model: nextModel });
      if (this.props.onChange) {
        this.props.onChange(nextModel);
      }
    };


    const { model } = this.state;

    if (model) {
      return (
        <div className="vis_editor">
          <VisPicker
            model={model}
            onChange={handleChange} />
          <VisEditorVisualization
            model={model}
            visData={this.props.visData}
            onBrush={this.props.onBrush}
            onChange={handleChange} />
          <PanelConfig
            fields={this.props.fields}
            model={model}
            visData={this.props.visData}
            onChange={handleChange} />
        </div>
      );
    }
    return null;
  }

}

VisEditor.propTypes = {
  fields: PropTypes.object,
  model: PropTypes.object,
  onBrush: PropTypes.func,
  onChange: PropTypes.func,
  visData: PropTypes.object
};

export default VisEditor;
