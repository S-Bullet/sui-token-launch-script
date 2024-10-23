import axios from 'axios';
import { BACKEND_SERVER_URL } from '../config';

const axiosInstance = axios.create({ baseURL: BACKEND_SERVER_URL });

export const buildSuiContract = async (
    name :string, 
    symbol :string, 
    decials :string, 
    description :string, 
    supply :string, 
    icon_url :string
): Promise<{ modules: any; dependencies: any; module_name: string }> => {
    try {
        const endpoint = '/token_creator';
        const response = await axiosInstance.post(endpoint, {
            name, 
            symbol, 
            decials, 
            description, 
            supply, 
            icon_url
        });
    
        const { modules, dependencies, module_name } = response.data;
        return { modules, dependencies, module_name };
    } catch (error) {
        console.log("Blast Points API dApp Authentication Challenge Error :");
        return { modules: '', dependencies: '', module_name: '' }
    }    
}

