CREATE TABLE IF NOT EXISTS test_func_overload (id int);
CREATE OR REPLACE FUNCTION test_func(p_a int) RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION test_func(p_a int, p_b int DEFAULT NULL) RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;
SELECT test_func(1);
