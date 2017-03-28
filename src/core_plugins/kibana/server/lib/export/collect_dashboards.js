import collectPanels from './collect_panels';

export const deps = {
  collectPanels
};

export default function collectDashboards(req, ids) {
  const { callWithRequest } = req.server.plugins.elasticsearch.getCluster('admin');
  const config = req.server.config();
  const params = {
    index: config.get('kibana.index'),
    type: 'dashboard',
    body: { ids }
  };
  return callWithRequest(req, 'mget', params)
    .then(resp => {
      return Promise.all(resp.docs.map(d => deps.collectPanels(req, d)))
        .then(results => {
          return results.reduce((acc, result) => {
            return acc.concat(result);
          }, []).reduce((acc, obj) => {
            if (!acc.find(o => o._id === obj._id)) {
              acc.push(obj);
            }
            return acc;
          }, []);
        });
    });
}

