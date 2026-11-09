import enUS from 'antd/locale/en_US';
import type { Locale } from 'antd/es/locale';
import { DATE_FORMAT } from './format';

const datePicker = enUS.DatePicker!;

/** antd's English locale with every date picker defaulting to DD/MM/YYYY
 * (docs/15). A picker given its own `format` (month pickers) keeps it. */
export const appLocale: Locale = {
  ...enUS,
  DatePicker: {
    ...datePicker,
    lang: {
      ...datePicker.lang,
      fieldDateFormat: DATE_FORMAT,
      fieldDateTimeFormat: `${DATE_FORMAT} HH:mm:ss`,
    },
  },
};
