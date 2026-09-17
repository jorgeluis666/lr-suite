export interface UtmForm {
  baseUrl: string;
  marca: string;
  source: string;
  medium: string;
  campaignType: string;
  campaignName: string;
  adSet: string;
  adName: string;
}

export interface UtmParams {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term?: string;
  utm_content?: string;
}

export interface UtmResult {
  url: string;
  params: UtmParams;
}
