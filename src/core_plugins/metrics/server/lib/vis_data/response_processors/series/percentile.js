import _ from 'lodash';
import basicAggs from '../../../../../public/components/lib/basic_aggs';
import getAggValue from '../../get_agg_value';
import getDefaultDecoration from '../../get_default_decoration';
import getSplits from '../../get_splits';
import getLastMetric from '../../get_last_metric';
import mapBucket from '../../map_bucket';
export default function percentile(resp, panel, series) {
  return next => results => {
    const metric = getLastMetric(series);
    if (metric.type !== 'percentile') return next(results);

    getSplits(resp, series).forEach((split) => {
      metric.percentiles.forEach(percentile => {
        const label = (split.label) + ` (${percentile.value})`;
        const data = split.timeseries.buckets.map(bucket => {
          const m = _.assign({}, metric, { percent: percentile.value });
          return [bucket.key, getAggValue(bucket, m)];
        });
        if (percentile.mode === 'band') {
          const fillData = split.timeseries.buckets.map(bucket => {
            const m = _.assign({}, metric, { percent: percentile.percentile });
            return [bucket.key, getAggValue(bucket, m)];
          });
          results.push({
            id: `${percentile.id}:${split.id}`,
            color: split.color,
            label,
            data,
            lines: { show: true, fill: percentile.shade, lineWidth: 0 },
            points: { show: false },
            legend: false,
            fillBetween: `${percentile.id}:${split.id}:${percentile.percentile}`
          });
          results.push({
            id: `${percentile.id}:${split.id}:${percentile.percentile}`,
            color: split.color,
            label,
            data: fillData,
            lines: { show: true, fill: false, lineWidth: 0 },
            legend: false,
            points: { show: false }
          });
        } else {
          const decoration = getDefaultDecoration(series);
          results.push({
            id: `${percentile.id}:${split.id}`,
            color: split.color,
            label,
            data,
            ...decoration
          });
        }
      });

    });
    return next(results);
  };
}
