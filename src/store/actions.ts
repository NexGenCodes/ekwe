import { ObservableObject } from "@legendapp/state";

type FieldSettersResult<T> = {
  [K in keyof T as `set${Capitalize<(K extends string ? K : never)>}`]: (
    value: T[K],
  ) => void;
};

export function fieldSetters<T>(
  store$: ObservableObject<T>,
  ...fields: (keyof T)[]
): FieldSettersResult<T> {
  const actions: Record<string, (value: T[keyof T]) => void> = {};
  for (const key of fields) {
    const name = `set${String(key).charAt(0).toUpperCase()}${String(key).slice(1)}`;
    actions[name] = (value: T[keyof T]): void => {
      (
        store$ as unknown as Record<
          string,
          { set: (v: T[keyof T]) => void }
        >
      )[key as string].set(value);
    };
  }
  return actions as unknown as FieldSettersResult<T>;
}
