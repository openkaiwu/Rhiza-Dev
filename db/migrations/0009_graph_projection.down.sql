-- Graph projections are rebuildable, but layout is user data. Export layout before rollback.
DROP TABLE IF EXISTS projection_aliases;
DROP TABLE IF EXISTS projection_checkpoints;
DROP TABLE IF EXISTS graph_layout_nodes;
DROP TABLE IF EXISTS graph_layouts;
DROP TABLE IF EXISTS graph_relations;
DROP TABLE IF EXISTS workspace_objects;
