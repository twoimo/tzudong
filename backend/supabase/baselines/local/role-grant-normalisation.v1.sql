-- Objects created by the privileged role are owned by privacy_workflow_owner.
-- postgres reaches them through explicit grants; role membership is forbidden by
-- the g013/g014 guards (`privacy_workflow_owner role attributes are incompatible`).
GRANT USAGE, CREATE ON SCHEMA privacy_retention TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA privacy_retention TO postgres;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA privacy_retention TO postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA privacy_retention TO postgres;
