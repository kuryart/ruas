export class ApiClient {
	private baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	}

	private async request(
		url: string,
		method: string,
		body?: any,
		contentType?: string
	): Promise<any> {
		const headers: HeadersInit = {};
		let requestBody: BodyInit | undefined;

		if (body !== undefined) {
			if (contentType === 'application/json') {
				headers['Content-Type'] = 'application/json';
				requestBody = JSON.stringify(body);
			} else if (contentType === 'text/plain') {
				headers['Content-Type'] = 'text/plain';
				requestBody = String(body);
			} else {
				headers['Content-Type'] = 'application/json';
				requestBody = JSON.stringify(body);
			}
		}

		const response = await fetch(`${this.baseUrl}${url}`, {
			method,
			headers: headers,
			body: requestBody as BodyInit,
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error");
			throw new Error(`HTTP error! Status: ${response.status}, Details: ${errorText}`);
		}

		const responseContentType = response.headers.get('Content-Type');
		if (responseContentType && responseContentType.includes('application/json')) {
			return response.json();
		} else {
			return response.text();
		}
	}

	get(url: string): Promise<any> {
		return this.request(url, "GET");
	}

	post(url: string, body?: any, contentType: string = 'application/json'): Promise<any> {
		return this.request(url, "POST", body, contentType);
	}
}

export const apiClient = new ApiClient("http://localhost:8080");
